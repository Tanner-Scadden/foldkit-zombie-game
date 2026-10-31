// NOTE: the project's own oxlint rules (AGENTS.md "Code shape"), loaded as a
// JS plugin by .oxlintrc.json. Plain JavaScript, so oxlint loads it in Node
// with no build step.

const isTagMember = node =>
  node?.type === 'MemberExpression' &&
  !node.computed &&
  node.property.type === 'Identifier' &&
  node.property.name === '_tag'

const unwrapChain = node =>
  node?.type === 'ChainExpression' ? node.expression : node

const isStringLiteral = node =>
  node?.type === 'Literal' && typeof node.value === 'string'

// NOTE: the source text of X in `X._tag === 'Name'` (either side, === or
// !==), or of the shared X in `X._tag === 'A' || X._tag === 'B'`, or of the
// first X in `X._tag === 'A' && more`. Anything else has no subject.
const tagSubject = (node, sourceCode) => {
  if (node === null || node === undefined) {
    return undefined
  }
  if (
    node.type === 'BinaryExpression' &&
    (node.operator === '===' || node.operator === '!==')
  ) {
    const left = unwrapChain(node.left)
    const right = unwrapChain(node.right)
    const member =
      isTagMember(left) && isStringLiteral(right)
        ? left
        : isTagMember(right) && isStringLiteral(left)
          ? right
          : undefined
    return member === undefined ? undefined : sourceCode.getText(member.object)
  }
  if (node.type === 'LogicalExpression' && node.operator === '||') {
    const left = tagSubject(node.left, sourceCode)
    return left !== undefined && left === tagSubject(node.right, sourceCode)
      ? left
      : undefined
  }
  if (node.type === 'LogicalExpression' && node.operator === '&&') {
    return tagSubject(node.left, sourceCode)
  }
  return undefined
}

const endsInReturn = node =>
  node.type === 'ReturnStatement' ||
  (node.type === 'BlockStatement' &&
    node.body.length > 0 &&
    node.body[node.body.length - 1].type === 'ReturnStatement')

const TAG_CHAIN_MESSAGE =
  'A chain of _tag checks on one value: match it exhaustively with the union\'s .match, Match.valueTags, or Match.tags (AGENTS.md "Code shape").'

const noTagChain = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Match a union exhaustively instead of chaining checks on its _tag.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode
    return {
      // NOTE: `if (x._tag === 'A') … else if (x._tag === 'B') …`
      IfStatement(node) {
        if (
          node.parent?.type === 'IfStatement' &&
          node.parent.alternate === node
        ) {
          return
        }
        const subject = tagSubject(node.test, sourceCode)
        if (subject === undefined) {
          return
        }
        const next = node.alternate
        if (
          next?.type === 'IfStatement' &&
          tagSubject(next.test, sourceCode) === subject
        ) {
          context.report({ node, message: TAG_CHAIN_MESSAGE })
        }
      },
      // NOTE: `if (x._tag === 'A') { return … } if (x._tag === 'B') { return … }`
      'BlockStatement, Program, StaticBlock'(node) {
        const body = node.body
        for (let index = 1; index < body.length; index++) {
          const previous = body[index - 1]
          const current = body[index]
          if (
            previous.type !== 'IfStatement' ||
            current.type !== 'IfStatement' ||
            previous.alternate !== null ||
            !endsInReturn(previous.consequent)
          ) {
            continue
          }
          const subject = tagSubject(previous.test, sourceCode)
          if (
            subject !== undefined &&
            tagSubject(current.test, sourceCode) === subject
          ) {
            context.report({ node: previous, message: TAG_CHAIN_MESSAGE })
          }
        }
      },
      // NOTE: `x._tag === 'A' ? a : x._tag === 'B' ? b : c`
      ConditionalExpression(node) {
        if (
          node.parent?.type === 'ConditionalExpression' &&
          node.parent.alternate === node
        ) {
          return
        }
        const subject = tagSubject(node.test, sourceCode)
        const next = node.alternate
        if (
          subject !== undefined &&
          next.type === 'ConditionalExpression' &&
          tagSubject(next.test, sourceCode) === subject
        ) {
          context.report({ node, message: TAG_CHAIN_MESSAGE })
        }
      },
    }
  },
}

const unwrapReadonly = node =>
  node?.type === 'TSTypeReference' &&
  node.typeName.type === 'Identifier' &&
  node.typeName.name === 'Readonly' &&
  (node.typeArguments ?? node.typeParameters)?.params.length === 1
    ? (node.typeArguments ?? node.typeParameters).params[0]
    : node

const hasTagMember = node =>
  node?.type === 'TSTypeLiteral' &&
  node.members.some(
    member =>
      member.type === 'TSPropertySignature' &&
      ((member.key.type === 'Identifier' && member.key.name === '_tag') ||
        (member.key.type === 'Literal' && member.key.value === '_tag')),
  )

const noExtractTag = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Name a union variant once beside the union instead of Extract<Union, { _tag }>.',
    },
  },
  create(context) {
    return {
      TSTypeReference(node) {
        const params = (node.typeArguments ?? node.typeParameters)?.params
        if (
          node.typeName.type === 'Identifier' &&
          node.typeName.name === 'Extract' &&
          params?.length === 2 &&
          hasTagMember(unwrapReadonly(params[1]))
        ) {
          context.report({
            node,
            message:
              'Name the variant once beside its union (type Turret = typeof Trap.Turret.Type) and use that name (AGENTS.md "Code shape").',
          })
        }
      },
    }
  },
}

// NOTE: `JSON.parse` and `JSON.stringify`, or the same off `globalThis`.
// oxlint's no-restricted-properties would do, but an override replaces its
// whole list, so the files allowed raw JSON would have to repeat every
// other restricted property. A rule of its own is turned off file by file.
const isJsonObject = node =>
  (node?.type === 'Identifier' && node.name === 'JSON') ||
  (node?.type === 'MemberExpression' &&
    !node.computed &&
    node.object.type === 'Identifier' &&
    node.object.name === 'globalThis' &&
    node.property.type === 'Identifier' &&
    node.property.name === 'JSON')

const propertyName = node =>
  node.computed
    ? isStringLiteral(node.property)
      ? node.property.value
      : undefined
    : node.property.type === 'Identifier'
      ? node.property.name
      : undefined

const RAW_JSON_METHODS = new Set(['parse', 'stringify'])

const noRawJson = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Read and write JSON through a Schema (Schema.fromJsonString, schemaBodyJson) instead of raw JSON.parse or JSON.stringify.',
    },
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (
          isJsonObject(node.object) &&
          RAW_JSON_METHODS.has(propertyName(node))
        ) {
          context.report({
            node,
            message:
              'Raw JSON skips the Schema: use Schema.fromJsonString(YourSchema) or HttpClientRequest.schemaBodyJson, or add the file to the no-raw-json allowlist with a reason (AGENTS.md "Code shape").',
          })
        }
      },
    }
  },
}

// NOTE: the name m in `{ model: m }`, `{ model }`, or `unchanged(m)`: a
// Step's result that changes nothing. Anything else has no name.
const bareModelName = node => {
  if (
    node.type === 'ObjectExpression' &&
    node.properties.length === 1 &&
    node.properties[0].type === 'Property' &&
    !node.properties[0].computed &&
    node.properties[0].key.type === 'Identifier' &&
    node.properties[0].key.name === 'model' &&
    node.properties[0].value.type === 'Identifier'
  ) {
    return node.properties[0].value.name
  }
  if (
    node.type === 'CallExpression' &&
    node.callee.type === 'Identifier' &&
    node.callee.name === 'unchanged' &&
    node.arguments.length === 1 &&
    node.arguments[0].type === 'Identifier'
  ) {
    return node.arguments[0].name
  }
  return undefined
}

// NOTE: whether the name appears in the call's arguments, at any depth:
// `step(m)`, `leaveFor(m, 'Kicked')`, `playSounds(cues)(keep(m))`.
const mentions = (node, name) => {
  if (node === null || typeof node !== 'object') {
    return false
  }
  if (node.type === 'Identifier') {
    return node.name === name
  }
  return Object.entries(node).some(
    ([key, value]) =>
      key !== 'parent' &&
      (Array.isArray(value)
        ? value.some(child => mentions(child, name))
        : typeof value === 'object' && mentions(value, name)),
  )
}

const isStepCallOn = (node, name) =>
  name !== undefined &&
  node.type === 'CallExpression' &&
  (node.arguments.some(argument => mentions(argument, name)) ||
    (node.callee.type === 'CallExpression' && isStepCallOn(node.callee, name)))

const noConditionalStep = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Run a Step on a condition with stepWhen, not a ternary whose other branch is { model }.',
    },
  },
  create(context) {
    return {
      // NOTE: `cond ? step(m) : { model: m }`, either way round.
      ConditionalExpression(node) {
        const { consequent, alternate } = node
        if (
          isStepCallOn(consequent, bareModelName(alternate)) ||
          isStepCallOn(alternate, bareModelName(consequent))
        ) {
          context.report({
            node,
            message:
              'A Step run on a condition: use stepWhen(isDue, step) from src/stepWhen.ts, or match the union when the condition narrows it (AGENTS.md "Code shape").',
          })
        }
      },
    }
  },
}

// NOTE: a value named as a World: `world`, `nextWorld`, `x.world`.
const isWorldNamed = node =>
  (node.type === 'Identifier' && /^world$|World$/.test(node.name)) ||
  (node.type === 'MemberExpression' &&
    !node.computed &&
    node.property.type === 'Identifier' &&
    /^world$|World$/.test(node.property.name))

const noWorldSpread = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Merge a World into a Model with withWorld, not by spreading it.',
    },
  },
  create(context) {
    return {
      // NOTE: `{ ...model, ...world }`: a spread after the first one.
      ObjectExpression(node) {
        node.properties.forEach((property, index) => {
          if (
            index > 0 &&
            property.type === 'SpreadElement' &&
            isWorldNamed(property.argument)
          ) {
            context.report({
              node: property,
              message:
                'A World spread over a Model: use withWorld(model, step) from src/world.ts (AGENTS.md "Code shape").',
            })
          }
        })
      },
    }
  },
}

// NOTE: the Model fields that say which menu is up. menuState in
// src/menuState.ts reads them; everything else reads menuState. A new
// dialog Binding joins this list and MenuState together.
const DIALOG_FIELDS = new Set([
  'shopDialog',
  'profileDialog',
  'panelDialog',
  'handDialog',
  'homeScreenSteps',
  'updateGreeting',
])

const memberName = node =>
  node?.type === 'MemberExpression' &&
  !node.computed &&
  node.property.type === 'Identifier'
    ? node.property.name
    : undefined

const noMenuField = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Read which menu is up from menuState(model), not from the dialog and co-op fields.',
    },
  },
  create(context) {
    return {
      // NOTE: `model.profileDialog.isOpen`, `model.coop.screen`.
      MemberExpression(node) {
        const name = memberName(node)
        const owner = memberName(node.object)
        if (
          (name === 'isOpen' && DIALOG_FIELDS.has(owner)) ||
          (name === 'screen' && owner === 'coop')
        ) {
          context.report({
            node,
            message:
              'Which menu is up comes from menuState(model) in src/menuState.ts (or isCoopOpen for co-op), so every gate agrees (AGENTS.md "Code shape").',
          })
        }
      },
    }
  },
}

// NOTE: `const X = makeCommand(...)` or `const X = Definition.makeCommand(...)`.
const isMakeCommand = node =>
  node?.type === 'CallExpression' &&
  ((node.callee.type === 'Identifier' && node.callee.name === 'makeCommand') ||
    memberName(node.callee) === 'makeCommand')

const commandBesideUpdate = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Define a Command in the module whose update returns it, not in a module of Commands.',
    },
  },
  create(context) {
    const commands = []
    const called = new Set()
    return {
      VariableDeclarator(node) {
        if (node.id.type === 'Identifier' && isMakeCommand(node.init)) {
          commands.push(node.id)
        }
      },
      CallExpression(node) {
        if (node.callee.type === 'Identifier') {
          called.add(node.callee.name)
        }
      },
      'Program:exit'() {
        commands
          .filter(command => !called.has(command.name))
          .forEach(command =>
            context.report({
              node: command,
              message: `${command.name} is never returned here: define a Command beside the update that returns it, and its .layer joins CommandsLayer in src/layer.ts (AGENTS.md "Code shape").`,
            }),
          )
      },
    }
  },
}

// NOTE: the ways to run an Effect by hand. A test runs its Effect with
// `it.effect` from @effect/vitest instead, which gives it a Scope and the
// TestClock.
const RUN_METHODS = new Set([
  'runPromise',
  'runPromiseExit',
  'runSync',
  'runSyncExit',
  'runFork',
])

const RUN_IN_TESTS_MESSAGE =
  'A test runs its Effect with it.effect from @effect/vitest (it.live for real time, layer(...) to share a Layer), not by hand (AGENTS.md "Code shape").'

const isEffectModule = source =>
  source === 'effect' || source === 'effect/Effect'

const noRunInTests = {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Run a test's Effect with it.effect from @effect/vitest, not Effect.runPromise, runSync, or runFork.",
    },
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (
          node.object.type === 'Identifier' &&
          node.object.name === 'Effect' &&
          RUN_METHODS.has(propertyName(node))
        ) {
          context.report({ node, message: RUN_IN_TESTS_MESSAGE })
        }
      },
      ImportSpecifier(node) {
        if (
          isEffectModule(node.parent.source.value) &&
          node.imported.type === 'Identifier' &&
          RUN_METHODS.has(node.imported.name)
        ) {
          context.report({ node, message: RUN_IN_TESTS_MESSAGE })
        }
      },
    }
  },
}

// NOTE: a press acts on its OnClick. src/touchTaps.ts makes every touch tap
// a click from that finger's own pointer events, so a button works with
// another finger on the glass and acts once. A handler on a touch's or a
// mouse's release, or on a touch's start, would act beside that click, or
// in its place on one device only. OnPointerDown stays allowed: the game
// surface, the HUD slots, and the hold-to-buy button act the moment a
// finger lands, which no click can.
const RELEASE_HANDLERS = new Set([
  'OnTouchStart',
  'OnTouchEnd',
  'OnTouchCancel',
  'OnPointerUp',
  'OnMouseDown',
  'OnMouseUp',
])

const TAP_BY_CLICK_MESSAGE =
  'Act on OnClick: src/touchTaps.ts turns every touch tap into a click, so the press works with another finger down and acts once. OnPointerDown is the one press handler for acting as a finger lands.'

const tapByClick = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Act on OnClick (made from each finger by src/touchTaps.ts), never on a touch or mouse release or a touch start.',
    },
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (RELEASE_HANDLERS.has(propertyName(node))) {
          context.report({ node, message: TAP_BY_CLICK_MESSAGE })
        }
      },
    }
  },
}

export default {
  meta: { name: 'munch' },
  rules: {
    'no-tag-chain': noTagChain,
    'no-extract-tag': noExtractTag,
    'no-raw-json': noRawJson,
    'no-conditional-step': noConditionalStep,
    'no-world-spread': noWorldSpread,
    'no-menu-field': noMenuField,
    'command-beside-update': commandBesideUpdate,
    'no-run-in-tests': noRunInTests,
    'tap-by-click': tapByClick,
  },
}
