-- Which way a share went: the phone's share sheet ('Sheet') or X's intent
-- link ('Link'). Shares from before it were all the link.
ALTER TABLE shares ADD COLUMN path TEXT NOT NULL DEFAULT 'Link';
