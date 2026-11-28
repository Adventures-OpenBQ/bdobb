// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The one list of financial-statement lines: which section each provider field
 * belongs to, in display order. Template 1.1.0 and the quick Statement view
 * both read it, so a line placed for one is placed for the other.
 *
 * Every block below names where its field names came from. The sources are
 * template 1.0.0's own lists, the yfinance SDK's statement keys, OpenBB's SEC
 * statement schema, and names observed in recorded rows (./fixtures). Section
 * placement is this file's own judgement. No other project's line lists were
 * an input (docs/superpowers/specs/2026-11-28-libre-statement-pivot-design.md,
 * "Clean-source rule").
 *
 * A field appears once per statement: the first block that names it places it.
 * Template 1.0.0 is pinned separately in ./taxonomy.ts and never reads this.
 */
export type VocabularyStatement = "income" | "balance" | "cashflow";
export type LineEmphasis = "subtotal" | "total";
export type LineUnit = "shares" | "per_share";

export const VOCABULARY: Record<VocabularyStatement, Record<string, readonly string[]>> = {
  income: {
    Income: [
      // Template 1.0.0's lines (FMP and EODHD names), in its order.
      "revenue", "operating_revenue", "interest_income", "net_interest_income",
      "non_operating_income_net_other", "non_operating_income_excluding_interest",
      "total_other_income_expense_net", "total_other_income_expenses", "other_items", "extraordinary_items",
      "non_recurring",
      // yfinance SDK 1.7.0 statement keys (yfinance/const.py, Apache-2.0), snake-cased as openbq-yfinance does, in statement order.
      "total_revenue", "interest_income_non_operating", "net_non_operating_interest_income_expense",
      "gain_on_sale_of_security", "earnings_from_equity_interest", "gain_on_sale_of_business",
      "gain_on_sale_of_ppe", "special_income_charges", "other_non_operating_income_expenses",
      "other_income_expense", "earnings_from_equity_interest_net_of_tax",
      "total_unusual_items_excluding_goodwill", "total_unusual_items",
      // openbb-sec 2.0.0 statement schema (utils/statement_schema/schemas, Apache-2.0), in its sequence.
      "other_revenue", "total_interest_income", "other_income", "other_gains", "total_other_income",
      "equity_method_investments", "gain_on_sale_properties", "loans_and_lease_interest_income",
      "investment_securities_interest_income", "deposits_interest_income",
      "fed_funds_and_repo_interest_income", "trading_account_interest_income", "other_interest_income",
      "revenues_excl_interest_dividends", "trust_fee_income", "service_charges_on_deposits_income",
      "other_service_charge_income", "net_realized_capital_gains", "premiums_earned",
      "investment_banking_income", "other_noninterest_income", "total_noninterest_income",
      "non_operating_income", "gain_loss_disposition_subsidiary",
    ],
    Expenses: [
      // Template 1.0.0's lines (FMP and EODHD names), in its order.
      "cost_of_revenue", "cost_and_expenses", "research_and_development_expense",
      "selling_and_marketing_expenses", "selling_and_marketing_expense",
      "selling_general_and_administrative_expense", "selling_general_and_admin_expense",
      "general_and_admin_expense", "other_operating_expenses", "other_expenses", "total_operating_expenses",
      "depreciation_and_amortization", "reconciled_depreciation", "interest_expense", "total_interest_expense",
      "income_tax_expense", "tax_provision", "effect_of_accounting_charges", "minority_interest",
      "preferred_stock_and_other_adjustments", "other_adjustments_to_net_income", "net_income_deductions",
      // yfinance SDK 1.7.0 statement keys (yfinance/const.py, Apache-2.0), snake-cased as openbq-yfinance does, in statement order.
      "other_non_interest_expense", "professional_expense_and_contract_services_expense",
      "occupancy_and_equipment", "policyholder_benefits_ceded", "policyholder_benefits_gross",
      "net_policyholder_benefits_and_claims", "loss_adjustment_expense", "excise_taxes", "salaries_and_wages",
      "rent_and_landing_fees", "insurance_and_claims", "other_gand_a", "general_and_administrative_expense",
      "selling_general_and_administration", "research_and_development", "depreciation_income_statement",
      "amortization_of_intangibles_income_statement", "amortization",
      "depreciation_and_amortization_in_income_statement", "depletion_income_statement",
      "depreciation_amortization_depletion_income_statement", "provision_for_doubtful_accounts", "other_taxes",
      "operating_expense", "interest_expense_non_operating", "total_other_finance_cost",
      "securities_amortization", "restructuring_and_mergern_acquisition", "impairment_of_capital_assets",
      "write_off", "other_special_charges", "minority_interests", "preferred_stock_dividends",
      "otherunder_preferred_stock_dividend", "rent_expense_supplemental", "total_expenses",
      "reconciled_cost_of_revenue", "tax_effect_of_unusual_items",
      // openbb-sec 2.0.0 statement schema (utils/statement_schema/schemas, Apache-2.0), in its sequence.
      "operating_cost_of_revenue", "other_cost_of_revenue", "total_cost_of_revenue", "excise_and_sales_taxes",
      "sga_expense", "rd_expense", "exploration_expense", "depreciation_expense", "amortization_expense",
      "depletion_expense", "impairment_expense", "restructuring_charge", "costs_and_expenses",
      "income_tax_current", "income_tax_deferred", "other_adjustments_to_consolidated_net_income",
      "preferred_dividends", "net_income_nci_redeemable", "net_income_nci_nonredeemable",
      "net_income_to_noncontrolling_interest", "other_adjustments_to_net_income_to_common",
      "deposits_interest_expense", "short_term_borrowing_interest_expense", "long_term_debt_interest_expense",
      "fed_funds_and_repo_interest_expense", "capitalized_lease_obligation_interest_expense",
      "other_interest_expense", "provision_for_credit_losses", "current_and_future_benefits",
      "salaries_and_employee_benefits_expense", "net_occupancy_equipment_expense", "marketing_expense",
      "property_liability_insurance_claims", "policy_acquisition_costs",
      "amortization_of_deferred_policy_acquisition_costs", "total_noninterest_expense",
      "benefits_costs_expenses",
    ],
    Profit: [
      // Template 1.0.0's lines (FMP and EODHD names), in its order.
      "gross_profit", "operating_income", "total_operating_income", "ebit", "ebitda", "income_before_tax",
      "total_pre_tax_income", "net_income_from_continuing_ops", "net_income_from_continuing_operations",
      "net_income_from_discontinued_operations", "discontinued_operations", "consolidated_net_income",
      "net_income", "net_income_to_common", "bottom_line_net_income",
      // yfinance SDK 1.7.0 statement keys (yfinance/const.py, Apache-2.0), snake-cased as openbq-yfinance does, in statement order.
      "pretax_income", "net_income_continuous_operations", "net_income_discontinuous_operations",
      "net_income_extraordinary", "net_income_from_tax_loss_carryforward",
      "net_income_including_noncontrolling_interests", "net_income_common_stockholders",
      "average_dilution_earnings", "diluted_ni_availto_com_stockholders", "total_operating_income_as_reported",
      "net_income_from_continuing_and_discontinued_operation", "normalized_income",
      "net_income_from_continuing_operation_net_minority_interest", "normalized_ebitda",
      // openbb-sec 2.0.0 statement schema (utils/statement_schema/schemas, Apache-2.0), in its sequence.
      "total_gross_profit", "total_pretax_income", "income_before_equity_method", "net_income_continuing",
      "net_income_discontinued", "extraordinary_income", "other_comprehensive_income_parent",
      "comprehensive_income_parent", "other_comprehensive_income_nci", "comprehensive_income_nci",
      "comprehensive_income", "net_interest_income_after_provision",
      // Seen in recorded rows (fixtures/libre, OpenBB's yfinance provider) and in neither list above.
      "net_income_attributable_to_common_shareholders",
    ],
    "Per share": [
      // yfinance SDK 1.7.0 statement keys (yfinance/const.py, Apache-2.0), snake-cased as openbq-yfinance does, in statement order.
      "basic_continuous_operations", "basic_discontinuous_operations", "basic_extraordinary",
      "basic_accounting_change", "tax_loss_carryforward_basic_eps", "basic_eps_other_gains_losses",
      "basic_eps", "diluted_continuous_operations", "diluted_discontinuous_operations",
      "diluted_extraordinary", "diluted_accounting_change", "tax_loss_carryforward_diluted_eps",
      "diluted_eps_other_gains_losses", "diluted_eps", "basic_average_shares", "diluted_average_shares",
      "dividend_per_share", "reported_normalized_basic_eps", "reported_normalized_diluted_eps",
      "continuing_and_discontinued_basic_eps", "continuing_and_discontinued_diluted_eps",
      "normalized_basic_eps", "normalized_diluted_eps",
      // openbb-sec 2.0.0 statement schema (utils/statement_schema/schemas, Apache-2.0), in its sequence.
      "weighted_ave_basic_shares_os", "weighted_ave_diluted_shares_os", "weighted_ave_basic_diluted_shares_os",
      "basic_diluted_eps", "cash_dividends_per_share",
      // Seen in recorded rows (fixtures/libre, OpenBB's yfinance provider) and in neither list above.
      "basic_earnings_per_share", "diluted_earnings_per_share", "weighted_average_basic_shares_outstanding",
      "weighted_average_diluted_shares_outstanding",
    ],
  },
  balance: {
    Assets: [
      // Template 1.0.0's lines (FMP and EODHD names), in its order.
      "cash", "cash_and_cash_equivalents", "short_term_investments", "cash_and_short_term_investments",
      "accounts_receivables", "other_receivables", "net_receivables", "inventory", "prepaid_expenses",
      "other_current_assets", "total_current_assets", "long_term_investments", "total_investments",
      "property_plant_equipment", "property_plant_and_equipment_gross", "accumulated_depreciation",
      "property_plant_equipment_net", "plant_property_equipment_net", "goodwill", "intangible_assets",
      "goodwill_and_intangible_assets", "accumulated_amortization", "deferred_long_term_asset_charges",
      "tax_assets", "other_non_current_assets", "non_currrent_assets_other", "non_current_assets",
      "non_current_assets_total", "other_assets", "earning_assets", "net_tangible_assets", "total_assets",
      // yfinance SDK 1.7.0 statement keys (yfinance/const.py, Apache-2.0), snake-cased as openbq-yfinance does, in statement order.
      "deferred_assets", "net_loan", "equity_investments", "fixed_maturity_investments",
      "cash_cash_equivalents_and_federal_funds_sold", "cash_financial", "cash_equivalents",
      "other_short_term_investments", "cash_cash_equivalents_and_short_term_investments",
      "gross_accounts_receivable", "allowance_for_doubtful_accounts_receivable", "accounts_receivable",
      "loans_receivable", "notes_receivable", "accrued_interest_receivable", "taxes_receivable",
      "duefrom_related_parties_current", "receivables_adjustments_allowances", "receivables", "raw_materials",
      "work_in_process", "finished_goods", "other_inventories", "inventories_adjustments_allowances",
      "prepaid_assets", "restricted_cash", "current_deferred_taxes_assets", "current_deferred_assets",
      "assets_held_for_sale_current", "hedging_assets_current", "current_assets", "properties",
      "land_and_improvements", "buildings_and_improvements", "machinery_furniture_equipment",
      "other_properties", "construction_in_progress", "leases", "gross_ppe", "net_ppe",
      "other_intangible_assets", "goodwill_and_other_intangible_assets", "investment_properties",
      "investmentsin_subsidiariesat_cost", "investmentsin_associatesat_cost",
      "investments_in_other_ventures_under_equity_method", "investmentsin_joint_venturesat_cost",
      "long_term_equity_investment", "trading_securities",
      "financial_assets_designatedas_fair_value_through_profitor_loss_total", "available_for_sale_securities",
      "held_to_maturity_securities", "investmentin_financial_assets", "other_investments",
      "investments_and_advances", "financial_assets", "non_current_accounts_receivable",
      "non_current_note_receivables", "duefrom_related_parties_non_current",
      "non_current_deferred_taxes_assets", "non_current_deferred_assets", "non_current_prepaid_assets",
      "defined_pension_benefit", "total_non_current_assets",
      "non_current_pension_and_other_postretirement_benefit_plans",
      // openbb-sec 2.0.0 statement schema (utils/statement_schema/schemas, Apache-2.0), in its sequence.
      "cash_and_equivalents", "note_receivable", "nontrade_receivables", "net_inventory",
      "current_deferred_tax_assets", "other_current_nonoperating_assets", "operating_lease_right_of_use_asset",
      "finance_lease_right_of_use_asset", "noncurrent_note_receivables", "noncurrent_deferred_tax_assets",
      "employee_benefit_assets", "other_noncurrent_assets", "other_noncurrent_nonoperating_assets",
      "other_noncurrent_assets_excl_ppe", "total_noncurrent_assets", "fed_funds_sold",
      "interest_bearing_deposits_at_other_banks", "time_deposits_placed", "trading_account_securities",
      "loans_and_leases", "allowance_for_loan_and_lease_losses", "net_loans_and_leases", "loans_held_for_sale",
      "accrued_investment_income", "customer_and_other_receivables", "net_premises_and_equipment",
      "mortgage_servicing_rights", "deferred_acquisition_cost", "separate_account_business_assets",
      // Seen in recorded rows (fixtures/libre, OpenBB's yfinance provider) and in neither list above.
      "inventories", "plant_property_equipment_gross",
    ],
    Liabilities: [
      // Template 1.0.0's lines (FMP and EODHD names), in its order.
      "accounts_payable", "accrued_expenses", "short_term_debt", "short_long_term_debt", "tax_payables",
      "current_deferred_revenue", "other_current_liabilities", "other_current_liab", "other_payables",
      "total_payables", "total_current_liabilities", "long_term_debt", "long_term_debt_total",
      "deferred_revenue_non_current", "deferred_tax_liabilities_non_current", "deferred_long_term_liab",
      "capital_lease_obligations_current", "capital_lease_obligations_non_current",
      "capital_lease_obligations", "other_non_current_liabilities", "non_current_liabilities_other",
      "total_non_current_liabilities", "non_current_liabilities_total", "other_liabilities", "other_liab",
      "total_liabilities", "total_debt", "net_debt",
      // yfinance SDK 1.7.0 statement keys (yfinance/const.py, Apache-2.0), snake-cased as openbq-yfinance does, in statement order.
      "income_tax_payable", "total_tax_payable", "dividends_payable", "dueto_related_parties_current",
      "other_payable", "payables", "interest_payable", "current_accrued_expenses",
      "payables_and_accrued_expenses", "current_provisions",
      "pensionand_other_post_retirement_benefit_plans_current", "current_notes_payable", "commercial_paper",
      "line_of_credit", "other_current_borrowings", "current_debt", "current_capital_lease_obligation",
      "current_debt_and_capital_lease_obligation", "current_deferred_taxes_liabilities",
      "current_deferred_liabilities", "current_liabilities", "long_term_provisions",
      "long_term_capital_lease_obligation", "long_term_debt_and_capital_lease_obligation",
      "non_current_deferred_taxes_liabilities", "non_current_deferred_revenue",
      "non_current_deferred_liabilities", "tradeand_other_payables_non_current",
      "dueto_related_parties_non_current", "non_current_accrued_expenses", "employee_benefits",
      "derivative_product_liabilities", "liabilities_heldfor_sale_non_current",
      "total_non_current_liabilities_net_minority_interest", "total_liabilities_net_minority_interest",
      // openbb-sec 2.0.0 statement schema (utils/statement_schema/schemas, Apache-2.0), in its sequence.
      "current_portion_of_long_term_debt", "customer_deposits", "current_deferred_tax_liabilities",
      "current_employee_benefit_liabilities", "other_taxes_payable", "other_current_nonoperating_liabilities",
      "operating_lease_liability_current", "finance_lease_liability_current",
      "operating_lease_liability_noncurrent", "asset_retirement_and_litigation_obligation",
      "noncurrent_deferred_revenue", "noncurrent_deferred_tax_liabilities",
      "noncurrent_employee_benefit_liabilities", "other_noncurrent_liabilities",
      "other_noncurrent_nonoperating_liabilities", "total_noncurrent_liabilities",
      "noninterest_bearing_deposits", "interest_bearing_deposits", "fed_funds_purchased",
      "bankers_acceptances", "accrued_interest_payable", "other_short_term_payables",
      "claims_and_claim_expenses", "future_policy_benefits", "unearned_premiums_credit", "policyholder_funds",
      "participating_policyholder_equity", "separate_account_business_liabilities",
      "other_long_term_liabilities",
    ],
    Equity: [
      // Template 1.0.0's lines (FMP and EODHD names), in its order.
      "preferred_stock", "preferred_stock_total_equity", "preferred_stock_redeemable", "common_stock",
      "common_stock_total_equity", "capital_stock", "treasury_stock", "retained_earnings",
      "retained_earnings_total_equity", "additional_paid_in_capital", "capital_surpluse",
      "accumulated_other_comprehensive_income", "other_shareholders_equity", "other_stockholder_equity",
      "other_total_shareholders_equity", "total_common_equity", "minority_interest",
      "noncontrolling_interest_in_consolidated_entity", "temporary_equity_redeemable_noncontrolling_interests",
      "total_equity_non_controlling_interests", "total_permanent_equity", "total_shareholders_equity",
      "warrants", "negative_goodwill", "liabilities_and_stockholders_equity",
      "total_liabilities_and_shareholders_equity", "total_liabilities_and_total_equity",
      "common_shares_outstanding", "net_working_capital", "net_invested_capital",
      // yfinance SDK 1.7.0 statement keys (yfinance/const.py, Apache-2.0), snake-cased as openbq-yfinance does, in statement order.
      "preferred_securities_outside_stock_equity", "restricted_common_stock", "limited_partnership_capital",
      "general_partnership_capital", "total_partnership_capital", "other_capital_stock",
      "unrealized_gain_loss", "minimum_pension_liabilities", "foreign_currency_translation_adjustments",
      "fixed_assets_revaluation_reserve", "other_equity_adjustments",
      "gains_losses_not_affecting_retained_earnings", "other_equity_interest", "stockholders_equity",
      "total_equity_gross_minority_interest", "total_capitalization", "preferred_stock_equity",
      "common_stock_equity", "working_capital", "invested_capital", "tangible_book_value", "share_issued",
      "ordinary_shares_number", "preferred_shares_number", "treasury_shares_number",
      // openbb-sec 2.0.0 statement schema (utils/statement_schema/schemas, Apache-2.0), in its sequence.
      "commitments_and_contingencies", "temporary_equity", "temporary_equity_parent",
      "redeemable_noncontrolling_interest", "redeemable_nci_common", "redeemable_nci_preferred",
      "redeemable_nci_other", "total_preferred_equity", "common_equity", "other_equity", "total_equity",
      "noncontrolling_interests", "total_equity_and_noncontrolling_interests", "total_liabilities_and_equity",
    ],
  },
  cashflow: {
    Operating: [
      // Template 1.0.0's lines (FMP and EODHD names), in its order.
      "net_income", "depreciation_and_amortization", "deferred_income_tax", "stock_based_compensation",
      "change_in_working_capital", "change_in_account_receivables", "change_receivables",
      "change_to_account_receivables", "change_in_inventory", "change_to_inventory",
      "change_in_account_payable", "change_to_liabilities", "change_in_other_working_capital",
      "change_to_operating_activities", "change_in_other_non_cash_items", "other_non_cash_items",
      "change_to_netincome", "cash_flows_other_operating", "net_cash_from_operating_activities",
      "operating_cash_flow", "net_income_from_continuing_operations", "depreciation_amortization_depletion",
      "deferred_tax", "changes_in_account_receivables", "change_in_receivables", "change_in_payable",
      "change_in_payables_and_accrued_expense", "change_in_other_current_assets",
      "change_in_other_current_liabilities", "cash_flow_from_continuing_operating_activities",
      // yfinance SDK 1.7.0 statement keys (yfinance/const.py, Apache-2.0), snake-cased as openbq-yfinance does, in statement order.
      "receiptsfrom_customers", "receiptsfrom_government_grants",
      "other_cash_receiptsfrom_operating_activities", "classesof_cash_receiptsfrom_operating_activities",
      "paymentsto_suppliersfor_goodsand_services", "paymentson_behalfof_employees",
      "other_cash_paymentsfrom_operating_activities", "classesof_cash_payments", "dividends_paid_direct",
      "dividends_received_direct", "interest_paid_direct", "interest_received_direct",
      "taxes_refund_paid_direct", "cash_flowsfromusedin_operating_activities_direct",
      "gain_loss_on_sale_of_business", "gain_loss_on_sale_of_ppe", "net_foreign_currency_exchange_gain_loss",
      "gain_loss_on_investment_securities", "earnings_losses_from_equity_investments",
      "pension_and_employee_benefit_expense", "operating_gains_losses", "depreciation",
      "amortization_of_intangibles", "amortization_cash_flow", "depletion", "amortization_of_securities",
      "asset_impairment_charge", "provisionand_write_offof_assets",
      "unrealized_gain_loss_on_investment_securities", "excess_tax_benefit_from_stock_based_compensation",
      "change_in_prepaid_assets", "change_in_income_tax_payable", "change_in_tax_payable",
      "change_in_dividend_payable", "change_in_interest_payable", "change_in_accrued_expense",
      "dividend_paid_cfo", "dividend_received_cfo", "interest_paid_cfo", "interest_received_cfo",
      "taxes_refund_paid", "cash_from_discontinued_operating_activities",
      // openbb-sec 2.0.0 statement schema (utils/statement_schema/schemas, Apache-2.0), in its sequence.
      "net_income_discontinued", "net_income_continuing", "depreciation_expense", "amortization_expense",
      "gain_loss_on_investments", "gain_loss_on_sale_of_assets", "income_loss_from_equity_method_investments",
      "asset_impairment_charges", "noncash_adjustments_to_net_income", "other_operating_activities",
      "change_in_accounts_receivable", "change_in_nontrade_receivables", "change_in_inventories",
      "change_in_accounts_payable", "change_in_other_operating_assets_and_liabilities",
      "increase_decrease_in_operating_capital", "net_cash_from_continuing_operating_activities",
      "net_cash_from_discontinued_operating_activities", "provision_for_loan_losses",
      "change_in_insurance_reserves",
    ],
    Investing: [
      // Template 1.0.0's lines (FMP and EODHD names), in its order.
      "capital_expenditure", "purchase_of_property_plant_and_equipment", "acquisitions", "investments",
      "purchase_of_investment_securities", "sale_and_maturity_of_investments", "other_investing_activities",
      "other_cashflows_from_investing_activities", "net_cash_from_investing_activities",
      "investments_in_property_plant_and_equipment", "net_ppe_purchase_and_sale", "purchase_of_business",
      "net_business_purchase_and_sale", "purchase_of_investment", "sale_of_investment",
      "net_investment_purchase_and_sale", "net_other_investing_changes",
      "cash_flow_from_continuing_investing_activities", "investing_cash_flow",
      // yfinance SDK 1.7.0 statement keys (yfinance/const.py, Apache-2.0), snake-cased as openbq-yfinance does, in statement order.
      "capital_expenditure_reported", "purchase_of_ppe", "sale_of_ppe", "purchase_of_intangibles",
      "sale_of_intangibles", "net_intangibles_purchase_and_sale", "sale_of_business",
      "purchase_of_investment_properties", "sale_of_investment_properties",
      "net_investment_properties_purchase_and_sale", "dividends_received_cfi", "interest_received_cfi",
      "cash_from_discontinued_investing_activities",
      // openbb-sec 2.0.0 statement schema (utils/statement_schema/schemas, Apache-2.0), in its sequence.
      "purchase_of_plant_property_and_equipment", "purchase_of_investments",
      "purchase_of_held_to_maturity_investments", "sale_of_plant_property_and_equipment",
      "sale_of_productive_assets", "divestitures", "sale_of_investments", "maturity_of_investments",
      "other_investing_activities_net", "net_cash_from_continuing_investing_activities",
      "net_cash_from_discontinued_investing_activities", "net_increase_in_fed_funds_sold",
      "loans_held_for_sale_net",
    ],
    Financing: [
      // Template 1.0.0's lines (FMP and EODHD names), in its order.
      "net_borrowings", "repayment_of_debt", "short_term_net_debt_issuance", "long_term_net_debt_issuance",
      "net_debt_issuance", "issuance_of_capital_stock", "issuance_of_common_equity",
      "repurchase_of_common_equity", "sale_purchase_of_stock", "net_common_equity_issuance",
      "net_preferred_equity_issuance", "net_equity_issuance", "dividends_paid", "common_dividends_paid",
      "preferred_dividends_paid", "net_dividends_paid", "other_financing_activities",
      "other_cashflows_from_financing_activities", "net_cash_from_financing_activities",
      "long_term_debt_issuance", "long_term_debt_payments", "net_long_term_debt_issuance",
      "net_short_term_debt_issuance", "net_issuance_payments_of_debt", "net_common_stock_issuance",
      "common_stock_dividend_paid", "cash_dividends_paid", "net_other_financing_charges",
      "cash_flow_from_continuing_financing_activities", "financing_cash_flow", "issuance_of_debt",
      "repurchase_of_capital_stock",
      // yfinance SDK 1.7.0 statement keys (yfinance/const.py, Apache-2.0), snake-cased as openbq-yfinance does, in statement order.
      "short_term_debt_issuance", "short_term_debt_payments", "common_stock_issuance", "common_stock_payments",
      "preferred_stock_issuance", "preferred_stock_payments", "net_preferred_stock_issuance",
      "preferred_stock_dividend_paid", "proceeds_from_stock_option_exercised", "interest_paid_cff",
      "cash_from_discontinued_financing_activities",
      // openbb-sec 2.0.0 statement schema (utils/statement_schema/schemas, Apache-2.0), in its sequence.
      "repurchase_of_preferred_equity", "payment_of_dividends", "issuance_of_preferred_equity",
      "short_term_debt_net", "tax_withholding_share_based_compensation", "other_financing_activities_net",
      "net_cash_from_continuing_financing_activities", "net_cash_from_discontinued_financing_activities",
      "net_change_in_deposits",
    ],
    "Cash position": [
      // Template 1.0.0's lines (FMP and EODHD names), in its order.
      "exchange_rate_changes", "effect_of_exchange_rate_changes_on_cash", "net_change_in_cash",
      "net_change_in_cash_and_equivalents", "cash_and_cash_equivalents_changes", "cash_at_beginning_of_period",
      "cash_at_end_of_period", "free_cash_flow", "income_taxes_paid", "interest_paid",
      "beginning_cash_position", "end_cash_position", "income_tax_paid_supplemental_data",
      "interest_paid_supplemental_data",
      // yfinance SDK 1.7.0 statement keys (yfinance/const.py, Apache-2.0), snake-cased as openbq-yfinance does, in statement order.
      "cash_flow_from_discontinued_operation", "other_cash_adjustment_inside_changein_cash", "changes_in_cash",
      "effect_of_exchange_rate_changes", "other_cash_adjustment_outside_changein_cash",
      // openbb-sec 2.0.0 statement schema (utils/statement_schema/schemas, Apache-2.0), in its sequence.
      "net_cash_from_discontinued_operations", "other_net_changes_in_cash", "cash_interest_paid",
      "cash_interest_received", "cash_income_taxes_paid",
    ],
  },
};

/** Lines drawn with emphasis: a statement's headline totals, and the subtotals that roll other lines up. */
export const EMPHASIS: Record<VocabularyStatement, Readonly<Record<string, LineEmphasis>>> = {
  income: {
    revenue: "total", net_interest_income: "subtotal", total_other_income_expense_net: "subtotal",
    total_other_income_expenses: "subtotal", total_operating_expenses: "subtotal",
    depreciation_and_amortization: "subtotal", total_interest_expense: "subtotal",
    income_tax_expense: "subtotal", gross_profit: "subtotal", operating_income: "subtotal",
    total_operating_income: "subtotal", ebit: "subtotal", ebitda: "subtotal", income_before_tax: "subtotal",
    total_pre_tax_income: "subtotal", net_income: "total", net_income_to_common: "subtotal",
    total_revenue: "total", total_other_finance_cost: "subtotal", pretax_income: "subtotal",
    basic_eps: "subtotal", diluted_eps: "subtotal", total_operating_income_as_reported: "subtotal",
    total_expenses: "subtotal", total_unusual_items_excluding_goodwill: "subtotal",
    total_unusual_items: "subtotal", total_cost_of_revenue: "subtotal", total_gross_profit: "subtotal",
    costs_and_expenses: "subtotal", total_interest_income: "subtotal", total_other_income: "subtotal",
    total_pretax_income: "subtotal", net_income_continuing: "subtotal",
    net_income_to_noncontrolling_interest: "subtotal", basic_diluted_eps: "subtotal",
    comprehensive_income_parent: "subtotal", comprehensive_income_nci: "subtotal",
    comprehensive_income: "subtotal", investment_securities_interest_income: "subtotal",
    total_noninterest_income: "subtotal", total_noninterest_expense: "subtotal",
    benefits_costs_expenses: "subtotal",
  },
  balance: {
    total_current_assets: "subtotal", total_investments: "subtotal", total_assets: "total",
    total_payables: "subtotal", total_current_liabilities: "subtotal",
    total_non_current_liabilities: "subtotal", total_liabilities: "total", total_debt: "subtotal",
    total_common_equity: "subtotal", total_equity_non_controlling_interests: "subtotal",
    total_permanent_equity: "subtotal", total_shareholders_equity: "total",
    liabilities_and_stockholders_equity: "total", total_liabilities_and_shareholders_equity: "total",
    total_liabilities_and_total_equity: "total", current_assets: "subtotal", net_ppe: "subtotal",
    total_non_current_assets: "subtotal", total_tax_payable: "subtotal", current_liabilities: "subtotal",
    total_non_current_liabilities_net_minority_interest: "subtotal",
    total_liabilities_net_minority_interest: "total", total_partnership_capital: "subtotal",
    stockholders_equity: "total", total_equity_gross_minority_interest: "total",
    total_capitalization: "subtotal", total_noncurrent_assets: "subtotal",
    total_noncurrent_liabilities: "subtotal", temporary_equity: "subtotal",
    redeemable_noncontrolling_interest: "subtotal", total_preferred_equity: "subtotal", total_equity: "total",
    total_equity_and_noncontrolling_interests: "subtotal", total_liabilities_and_equity: "total",
    net_loans_and_leases: "subtotal",
  },
  cashflow: {
    depreciation_and_amortization: "subtotal", net_cash_from_operating_activities: "total",
    operating_cash_flow: "total", cash_flow_from_continuing_operating_activities: "subtotal",
    net_cash_from_investing_activities: "total", cash_flow_from_continuing_investing_activities: "subtotal",
    investing_cash_flow: "total", net_cash_from_financing_activities: "total",
    cash_flow_from_continuing_financing_activities: "subtotal", financing_cash_flow: "total",
    net_change_in_cash: "total", free_cash_flow: "subtotal", changes_in_cash: "total",
    net_income_continuing: "subtotal", increase_decrease_in_operating_capital: "subtotal",
    net_cash_from_continuing_operating_activities: "subtotal",
    net_cash_from_continuing_investing_activities: "subtotal",
    net_cash_from_continuing_financing_activities: "subtotal",
  },
};

/** Lines that are not a currency amount. Everything unlisted is. */
export const UNITS: Record<VocabularyStatement, Readonly<Record<string, LineUnit>>> = {
  income: {
    basic_continuous_operations: "per_share", basic_discontinuous_operations: "per_share",
    basic_extraordinary: "per_share", basic_accounting_change: "per_share",
    tax_loss_carryforward_basic_eps: "per_share", basic_eps_other_gains_losses: "per_share",
    basic_eps: "per_share", diluted_continuous_operations: "per_share",
    diluted_discontinuous_operations: "per_share", diluted_extraordinary: "per_share",
    diluted_accounting_change: "per_share", tax_loss_carryforward_diluted_eps: "per_share",
    diluted_eps_other_gains_losses: "per_share", diluted_eps: "per_share", basic_average_shares: "shares",
    diluted_average_shares: "shares", dividend_per_share: "per_share",
    reported_normalized_basic_eps: "per_share", reported_normalized_diluted_eps: "per_share",
    continuing_and_discontinued_basic_eps: "per_share", continuing_and_discontinued_diluted_eps: "per_share",
    normalized_basic_eps: "per_share", normalized_diluted_eps: "per_share",
    weighted_ave_basic_shares_os: "shares", weighted_ave_diluted_shares_os: "shares",
    weighted_ave_basic_diluted_shares_os: "shares", basic_diluted_eps: "per_share",
    cash_dividends_per_share: "per_share", basic_earnings_per_share: "per_share",
    diluted_earnings_per_share: "per_share", weighted_average_basic_shares_outstanding: "shares",
    weighted_average_diluted_shares_outstanding: "shares",
  },
  balance: {
    common_shares_outstanding: "shares", share_issued: "shares", ordinary_shares_number: "shares",
    preferred_shares_number: "shares", treasury_shares_number: "shares",
  },
  cashflow: {
  },
};

/** Numeric fields a statement row carries that are not statement lines at all: ratios. Never placed in a section. */
export const NOT_MONEY: ReadonlySet<string> = new Set(["tax_rate_for_calcs"]);
