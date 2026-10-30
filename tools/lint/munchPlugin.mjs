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

export default {
  meta: { name: 'munch' },
  rules: {
    'no-tag-chain': noTagChain,
    'no-extract-tag': noExtractTag,
    'no-raw-json': noRawJson,
  },
}
