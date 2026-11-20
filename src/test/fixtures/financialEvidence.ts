// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// Canonical provider wire examples, with actual delivered rows where needed.
export const screenerEvidence = {
  "version": 1,
  "retrieved_at": "2026-11-19T16:00:00Z",
  "raw_count": 1,
  "normalized_count": 1,
  "delivered_count": 1,
  "diagnostics": [],
  "kind": "screener",
  "field_origins": {
    "symbol": "code+exchange",
    "exchange": "exchange",
    "currency_symbol": "currency_symbol",
    "last_day_data_date": "last_day_data_date",
    "market_cap": "market_capitalization",
    "dividend_yield": "dividend_yield",
    "price_change_5d": "refund_5d_p"
  },
  "units": {
    "market_cap": "listing-currency",
    "dividend_yield": "fraction",
    "price_change_5d": "fraction"
  },
  "scope": {
    "sort": "market_capitalization.desc",
    "limit": 50,
    "offset": 0,
    "signals": null,
    "filters": [
      [
        "exchange",
        "=",
        "us"
      ]
    ]
  },
  "unsafe": {
    "unassignable_identity": false,
    "unassignable_date": false,
    "unit_conflict": false
  },
  "cohorts": [
    {
      "price_date": "2026-08-28",
      "raw_count": 1,
      "denominations": [
        "USD"
      ],
      "unknown_denomination": false,
      "conflicting_duplicates": false,
      "exact_duplicate_count": 0
    }
  ]
};

export const dividendEvidence = {
  "version": 1,
  "retrieved_at": "2026-11-19T16:00:00Z",
  "raw_count": 1,
  "normalized_count": 1,
  "delivered_count": 1,
  "diagnostics": [],
  "kind": "dividends",
  "field_origins": {
    "ex_dividend_date": "date",
    "amount": "value",
    "currency": "currency",
    "frequency": "period"
  },
  "qualified_symbol": "SHEL.LSE",
  "amount_basis": "split-adjusted-current-share",
  "requested_start": "2026-01-01",
  "requested_end": "2026-06-30",
  "coverage": {
    "authority": "explicit-snapshot",
    "reference": "fixtures/shel-dividends-2026h1-v1",
    "start": "2026-01-01",
    "end": "2026-06-30",
    "status": "verified"
  },
  "unsafe": {
    "invalid_ex_date": false,
    "currency_conflict": false,
    "unknown_payment_currency": false,
    "instrument_conflict": false,
    "amount_basis_conflict": false,
    "outside_requested_window": false
  },
  "event_dates": [
    "2026-02-12"
  ],
  "invalid_amount_dates": [],
  "duplicate_dates": [],
  "payment_currencies": [
    "GBP"
  ]
};

export const emptyDividendEvidence = {
  "version": 1,
  "retrieved_at": "2026-11-19T16:00:00Z",
  "raw_count": 0,
  "normalized_count": 0,
  "delivered_count": 0,
  "diagnostics": [],
  "kind": "dividends",
  "field_origins": {
    "ex_dividend_date": "date",
    "amount": "value",
    "currency": "currency",
    "frequency": "period"
  },
  "qualified_symbol": "SHEL.LSE",
  "amount_basis": "split-adjusted-current-share",
  "requested_start": "2026-01-01",
  "requested_end": "2026-06-30",
  "coverage": {
    "authority": "explicit-snapshot",
    "reference": "fixtures/shel-dividends-2026h1-empty-v1",
    "start": "2026-01-01",
    "end": "2026-06-30",
    "status": "verified"
  },
  "unsafe": {
    "invalid_ex_date": false,
    "currency_conflict": false,
    "unknown_payment_currency": false,
    "instrument_conflict": false,
    "amount_basis_conflict": false,
    "outside_requested_window": false
  },
  "event_dates": [],
  "invalid_amount_dates": [],
  "duplicate_dates": [],
  "payment_currencies": []
};

export const clippedDividendEvidence = {
  "version": 1,
  "retrieved_at": "2026-11-19T16:00:00Z",
  "raw_count": 1,
  "normalized_count": 1,
  "delivered_count": 1,
  "diagnostics": [
    "clipped_coverage"
  ],
  "kind": "dividends",
  "field_origins": {
    "ex_dividend_date": "date",
    "amount": "value",
    "currency": "currency",
    "frequency": "period"
  },
  "qualified_symbol": "SHEL.LSE",
  "amount_basis": "split-adjusted-current-share",
  "requested_start": "2025-12-31",
  "requested_end": "2026-06-30",
  "coverage": {
    "authority": "explicit-snapshot",
    "reference": "fixtures/shel-dividends-2026h1-v1",
    "start": "2026-01-01",
    "end": "2026-06-30",
    "status": "clipped"
  },
  "unsafe": {
    "invalid_ex_date": false,
    "currency_conflict": false,
    "unknown_payment_currency": false,
    "instrument_conflict": false,
    "amount_basis_conflict": false,
    "outside_requested_window": false
  },
  "event_dates": [
    "2026-02-12"
  ],
  "invalid_amount_dates": [],
  "duplicate_dates": [],
  "payment_currencies": [
    "GBP"
  ]
};

export const incomeEvidence = {
  "version": 1,
  "retrieved_at": "2026-11-19T16:00:00Z",
  "raw_count": 1,
  "normalized_count": 1,
  "delivered_count": 1,
  "diagnostics": [],
  "kind": "income",
  "field_origins": {
    "period_ending": "date",
    "reporting_currency": "Financials.Income_Statement.currency_symbol",
    "revenue": "totalRevenue",
    "cost_of_revenue": "costOfRevenue",
    "gross_profit": "grossProfit",
    "operating_income": "operatingIncome",
    "income_before_tax": "incomeBeforeTax",
    "net_income": "netIncome",
    "income_tax_expense": "incomeTaxExpense"
  },
  "qualified_symbol": "HSBA.LSE",
  "period_kind": "FY",
  "reporting_currency": "USD",
  "scale": {
    "status": "verified",
    "authority": "explicit-snapshot",
    "multiplier": 1000.0,
    "reference": "fixtures/hsba-2026fy-v1"
  },
  "requested_limit": 1,
  "available_period_count": 2,
  "unsafe": {
    "invalid_period_identity": false,
    "scale_conflict": false
  },
  "periods": [
    {
      "period_end": "2026-06-30",
      "period_kind": "FY",
      "fiscal_year": 2026,
      "fiscal_period": "FY",
      "record_coverage": "full-record",
      "declared_currency": "USD",
      "currency_conflict": false,
      "scale_conflict": false,
      "identity_conflict": false,
      "field_origin_conflict": false,
      "present_fields": [
        "cost_of_revenue",
        "gross_profit",
        "income_before_tax",
        "income_tax_expense",
        "net_income",
        "operating_income",
        "revenue"
      ]
    }
  ]
};

export const dividendRow = { ex_dividend_date: '2026-02-12', amount: .2, unadjusted_amount: .8, currency: 'GBP', frequency: 'Special' };
export const incomeRow = { period_ending: '2026-06-30', fiscal_year: 2026, fiscal_period: 'FY', revenue: 100,
  cost_of_revenue: 40, gross_profit: 60, operating_income: 30, income_before_tax: 25, net_income: 20, income_tax_expense: 5 };
