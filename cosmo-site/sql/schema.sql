-- Cosmo site schema. Import once via hPanel → phpMyAdmin → Import, or:
--   mysql -u USER -p DBNAME < sql/schema.sql

CREATE TABLE IF NOT EXISTS visits (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    created_at  DATETIME      NOT NULL,
    ip          VARCHAR(45),
    country     VARCHAR(64),
    city        VARCHAR(128),
    referrer    VARCHAR(512),
    path        VARCHAR(255),
    user_agent  VARCHAR(512),
    INDEX idx_visits_created (created_at),
    INDEX idx_visits_country (country)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS leads (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    email       VARCHAR(255)  NOT NULL UNIQUE,
    created_at  DATETIME      NOT NULL,
    ip          VARCHAR(45),
    country     VARCHAR(64),
    city        VARCHAR(128),
    referrer    VARCHAR(512),
    consent     TINYINT(1)    NOT NULL DEFAULT 0,
    INDEX idx_leads_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS donations (
    id                   BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    created_at           DATETIME     NOT NULL,
    email                VARCHAR(255),
    amount_paise         INT          NOT NULL,        -- Razorpay works in the smallest unit
    currency             VARCHAR(8)   NOT NULL DEFAULT 'INR',
    razorpay_order_id    VARCHAR(64),
    razorpay_payment_id  VARCHAR(64),
    status               VARCHAR(24)  NOT NULL DEFAULT 'created',  -- created | paid | failed
    INDEX idx_don_created (created_at),
    INDEX idx_don_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
