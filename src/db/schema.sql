-- FinOps — schema v1 (PLAN.md §4)
-- Conventions: amounts REAL in original currency + amount_ils (₪, 2dp),
-- dates TEXT ISO-8601 (YYYY-MM-DD), booleans INTEGER 0/1.

CREATE TABLE IF NOT EXISTS accounts (
  id            INTEGER PRIMARY KEY,
  type          TEXT NOT NULL CHECK (type IN ('checking', 'card')),
  provider      TEXT NOT NULL,            -- scraper company id (e.g. hapoalim, max)
  display_name  TEXT NOT NULL,
  UNIQUE (provider, display_name)
);

CREATE TABLE IF NOT EXISTS transactions (
  id                   INTEGER PRIMARY KEY,
  account_id           INTEGER NOT NULL REFERENCES accounts(id),
  date                 TEXT NOT NULL,     -- transaction date
  charge_date          TEXT,              -- billing date (cards; PLAN.md §5)
  amount               REAL NOT NULL,     -- original currency; negative = expense
  currency             TEXT NOT NULL DEFAULT 'ILS',
  amount_ils           REAL NOT NULL,
  raw_description      TEXT NOT NULL,
  normalized_merchant  TEXT,
  category             TEXT,
  dedup_hash           TEXT NOT NULL UNIQUE,  -- sha256(date|amount|normalized_description|account_id)
  source               TEXT NOT NULL,     -- which scraper produced the row
  is_transfer          INTEGER NOT NULL DEFAULT 0 CHECK (is_transfer IN (0, 1)),
  is_fee               INTEGER NOT NULL DEFAULT 0 CHECK (is_fee IN (0, 1)),
  is_fx                INTEGER NOT NULL DEFAULT 0 CHECK (is_fx IN (0, 1)),
  installment_current  INTEGER,
  installment_total    INTEGER,
  memo                 TEXT,
  -- v6: a human corrected THIS specific row (merchant name and/or category).
  -- reclassify.ts skips these rows entirely — a merchant-level rule can't
  -- express "this one transaction is different from its siblings that
  -- share the same merchant name" (e.g. one of several identical-looking
  -- rent checks that's actually an unrelated gift).
  manual_override      INTEGER NOT NULL DEFAULT 0 CHECK (manual_override IN (0, 1)),
  -- v7: when the row entered the DB, which is NOT `date`. A charge dated last
  -- week that arrives in today's scrape is new to the user, so "what changed
  -- since you looked" keys off arrival time, not transaction date.
  ingested_at          TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_transactions_date          ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_account_date  ON transactions(account_id, date);
CREATE INDEX IF NOT EXISTS idx_transactions_merchant      ON transactions(normalized_merchant);
CREATE INDEX IF NOT EXISTS idx_transactions_category      ON transactions(category);

CREATE TABLE IF NOT EXISTS subscriptions (
  id          INTEGER PRIMARY KEY,
  merchant    TEXT NOT NULL UNIQUE,
  avg_amount  REAL NOT NULL,
  cadence     TEXT NOT NULL,              -- monthly | yearly | weekly | ...
  first_seen  TEXT NOT NULL,
  last_seen   TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'price_increased', 'forgotten', 'trial_converted'))
);

CREATE TABLE IF NOT EXISTS goals (
  id             INTEGER PRIMARY KEY,
  title          TEXT NOT NULL,
  type           TEXT NOT NULL CHECK (type IN ('save_by_date', 'cut_category', 'cap_monthly')),
  target_amount  REAL NOT NULL,
  category       TEXT,                    -- for cut_category / cap_monthly
  deadline       TEXT,                    -- for save_by_date
  progress       REAL NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS recommendations (
  id                   INTEGER PRIMARY KEY,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  title                TEXT NOT NULL,
  rationale            TEXT NOT NULL,
  category             TEXT,              -- duplicate_charge | subscription | fee_fx | cashflow | spending | other
  details              TEXT,              -- JSON: {what_happened, breakdown, change, impact_monthly, impact_yearly, steps}
  est_saving_ils       REAL,
  effort               TEXT CHECK (effort IN ('low', 'med', 'high')),
  confidence           REAL CHECK (confidence BETWEEN 0 AND 1),
  status               TEXT NOT NULL DEFAULT 'new'
                       CHECK (status IN ('new', 'accepted', 'dismissed', 'done')),
  realized_saving_ils  REAL
);

CREATE TABLE IF NOT EXISTS alerts (
  id             INTEGER PRIMARY KEY,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  type           TEXT NOT NULL,           -- anomaly | duplicate_charge | new_subscription | ...
  severity       TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  message        TEXT NOT NULL,
  related_tx_id  INTEGER REFERENCES transactions(id),
  dismissed      INTEGER NOT NULL DEFAULT 0 CHECK (dismissed IN (0, 1))
);

CREATE TABLE IF NOT EXISTS agent_memory (
  id          INTEGER PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- v4: what the user taught the agent about a merchant. Ground truth — wins
-- over automatic classification; the advisor must respect it.
CREATE TABLE IF NOT EXISTS merchant_notes (
  merchant    TEXT PRIMARY KEY,             -- normalized_merchant
  note        TEXT NOT NULL,
  category    TEXT,                         -- when set, overrides transaction category
  flag        TEXT CHECK (flag IN ('cancel', 'transfer')),  -- 'cancel' = should not be active; 'transfer' = internal move, exclude from expenses
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- v4: user questions about specific charges; the advisor answers on its next run.
CREATE TABLE IF NOT EXISTS tx_questions (
  id           INTEGER PRIMARY KEY,
  tx_id        INTEGER NOT NULL REFERENCES transactions(id),
  question     TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'resolved')),
  answer       TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  answered_at  TEXT
);
