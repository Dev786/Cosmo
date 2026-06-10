-- Run once on the server (hPanel → phpMyAdmin → SQL, or mysql CLI).
-- donations.amount_paise now stores MINOR UNITS of `currency` (paise/cents/pence).
ALTER TABLE donations ADD COLUMN processor VARCHAR(16) NULL AFTER status;
ALTER TABLE donations ADD COLUMN country   VARCHAR(2)  NULL AFTER currency;
ALTER TABLE donations ADD COLUMN ip_hash   CHAR(64)    NULL AFTER country;

CREATE TABLE IF NOT EXISTS webhook_events (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  processor   VARCHAR(16) NOT NULL,
  event_id    VARCHAR(80) NOT NULL,
  type        VARCHAR(64) NOT NULL,
  received_at DATETIME    NOT NULL,
  UNIQUE KEY uniq_event (processor, event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rate_limits (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ip_hash      CHAR(64)    NOT NULL,
  action       VARCHAR(32) NOT NULL,
  window_start DATETIME    NOT NULL,
  hits         INT         NOT NULL DEFAULT 1,
  UNIQUE KEY uniq_bucket (ip_hash, action, window_start),
  INDEX idx_rl_window (window_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
