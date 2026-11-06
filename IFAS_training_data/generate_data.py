"""
IFAS simulated training data generator
======================================
Creates SIMULATED (synthetic) financial data for the three IFAS workspace types
(PERSONAL, BUSINESS, ORGANIZATION). It is intended ONLY for developing and
testing the forecasting model, the unusual-spending detector, budget alerts and
the AI assistant. It is NOT real data and must never be reported as research
findings.

Run:  python generate_data.py
Output: CSV files in the same folder.
Change SEED to create a different (but equally structured) dataset.
"""
import calendar
import numpy as np
import pandas as pd

SEED = 2026
rng = np.random.default_rng(SEED)
START = pd.Timestamp("2023-11-01")
N_MONTHS = 36                       # Nov 2023 .. Oct 2026
MONTHS = pd.period_range(START, periods=N_MONTHS, freq="M")
ANOMALY_RATE = 0.04                 # share of expense rows that are anomalous
COLS = ["ref", "date", "description", "amount", "type", "account", "to_account", "category", "department"]


# ----------------------------------------------------------------- helpers
def r5(x):
    return int(max(5, round(float(x) / 5.0) * 5))


def lognorm(mean, sigma):
    """Lognormal draw with the given arithmetic mean."""
    mu = np.log(mean) - 0.5 * sigma ** 2
    return float(min(rng.lognormal(mu, sigma), 3.0 * mean))   # cap extreme normal values so that labelled anomalies stay distinguishable


def infl(m_idx, rate=0.005):
    return (1 + rate) ** m_idx


def pick(options, probs=None):
    return options[int(rng.choice(len(options), p=probs))]


def days_of(period):
    return calendar.monthrange(period.year, period.month)[1]


def sample_days(period, n, weekend_boost=1.0):
    nd = days_of(period)
    days = np.arange(1, nd + 1)
    w = np.array([weekend_boost if pd.Timestamp(period.year, period.month, d).weekday() >= 5 else 1.0 for d in days])
    w = w / w.sum()
    return sorted(int(d) for d in rng.choice(days, size=n, replace=True, p=w))


def mk(rows, period, day, desc, amount, typ, account, category, dept="", to_account=""):
    day = min(day, days_of(period))
    rows.append(dict(date=pd.Timestamp(period.year, period.month, day), description=desc, amount=r5(amount),
                     type=typ, account=account, to_account=to_account, category=category, department=dept))


def fixed_exp(rows, period, day, desc, amount, account, category, dept=""):
    mk(rows, period, day, desc, amount, "EXPENSE", account, category, dept)


def variable_exp(rows, period, m_idx, desc_list, accounts, category, n_mean, mean, sigma, season=1.0, weekend=1.0, dept="", inflation=0.005):
    n = int(rng.poisson(n_mean * (season if season > 1 else 1.0)))
    for d in sample_days(period, n, weekend):
        amt = lognorm(mean, sigma) * infl(m_idx, inflation) * season
        mk(rows, period, d, pick(desc_list), amt, "EXPENSE", pick(accounts), category, dept)


# ----------------------------------------------------------------- PERSONAL
def personal():
    rows = []
    season = {"Groceries": {12: 1.3, 1: 1.05, 4: 1.05}, "Transport": {12: 1.2, 1: 1.1}, "Dining Out": {12: 1.4, 8: 1.1},
              "Entertainment": {12: 1.5, 8: 1.2}, "Clothing": {12: 1.8, 1: 1.1, 4: 1.2}, "Airtime and Data": {12: 1.15}}
    rent = {2023: 25000, 2024: 26000, 2025: 27000, 2026: 28000}
    for i, p in enumerate(MONTHS):
        s = lambda c: season.get(c, {}).get(p.month, 1.0)
        raise_f = 1.0 + 0.05 * (p.year - 2023 if p.month >= 1 and p.year > 2023 else 0)
        mk(rows, p, 28, "Monthly salary", 120000 * raise_f, "INCOME", "Bank Account", "Salary")
        if p.month == 12:
            mk(rows, p, 20, "Year-end bonus", 40000 * raise_f, "INCOME", "Bank Account", "Salary")
        for d in sample_days(p, int(rng.poisson(1.3))):
            mk(rows, p, d, pick(["Freelance work", "Weekend gig", "Item sold online"]), lognorm(6000, 0.55), "INCOME", "M-Pesa", "Side Income")
        fixed_exp(rows, p, 5, "House rent", rent[p.year], "Bank Account", "Rent")
        variable_exp(rows, p, i, ["Supermarket shopping", "Fresh produce market", "Corner shop items"], ["M-Pesa", "Bank Account", "Cash"], "Groceries", 7, 2100, 0.45, s("Groceries"))
        variable_exp(rows, p, i, ["Matatu fare", "Boda boda ride", "Taxi ride", "Fuel"], ["M-Pesa", "Cash"], "Transport", 16, 420, 0.5, s("Transport"))
        variable_exp(rows, p, i, ["Electricity tokens"], ["M-Pesa"], "Utilities", 2, 1100, 0.25)
        fixed_exp(rows, p, 10, "Water bill", 900 * infl(i, 0.003), "M-Pesa", "Utilities")
        fixed_exp(rows, p, 12, "Home internet subscription", 3499, "M-Pesa", "Utilities")
        variable_exp(rows, p, i, ["Mobile airtime", "Data bundles"], ["M-Pesa"], "Airtime and Data", 5, 450, 0.35, s("Airtime and Data"))
        variable_exp(rows, p, i, ["Restaurant meal", "Coffee and snacks", "Takeaway"], ["M-Pesa", "Cash"], "Dining Out", 4, 1400, 0.55, s("Dining Out"), weekend=2.5)
        variable_exp(rows, p, i, ["Cinema", "Streaming subscription", "Weekend outing", "Concert ticket"], ["M-Pesa"], "Entertainment", 2.5, 1800, 0.7, s("Entertainment"), weekend=2.0)
        variable_exp(rows, p, i, ["Pharmacy", "Clinic visit", "Dental check-up"], ["M-Pesa", "Bank Account"], "Health", 1.1, 2400, 0.8)
        fee = {1: 20000, 5: 15000, 9: 15000}
        if p.month in fee:
            fixed_exp(rows, p, 8, "School fees", fee[p.month] * (1.04 ** (p.year - 2023)), "Bank Account", "Education")
        if p.month == 1:
            fixed_exp(rows, p, 10, "Books and stationery", 6000, "M-Pesa", "Education")
        fixed_exp(rows, p, 15, "Online course subscription", 2000, "M-Pesa", "Education")
        variable_exp(rows, p, i, ["Clothes", "Shoes", "Tailor"], ["M-Pesa", "Cash"], "Clothing", 1.2, 2600, 0.6, s("Clothing"))
        variable_exp(rows, p, i, ["Salon", "Toiletries"], ["M-Pesa", "Cash"], "Personal Care", 2, 900, 0.4)
        variable_exp(rows, p, i, ["Gift", "Church offering", "Other small expense"], ["M-Pesa", "Cash"], "Miscellaneous", 3, 800, 0.8)
        mk(rows, p, 29, "Monthly savings", 10000, "TRANSFER", "Bank Account", "Savings", to_account="Savings Account")
        for d in sample_days(p, 3):
            mk(rows, p, d, "Move money to M-Pesa", r5(lognorm(15000, 0.3)), "TRANSFER", "Bank Account", "Transfers", to_account="M-Pesa")
        for d in sample_days(p, 3):
            mk(rows, p, d, "Cash withdrawal", r5(lognorm(3000, 0.3)), "TRANSFER", "M-Pesa", "Transfers", to_account="Cash")
    return pd.DataFrame(rows)


# ----------------------------------------------------------------- BUSINESS
def business():
    rows = []
    wd = {0: 0.95, 1: 0.90, 2: 0.95, 3: 1.00, 4: 1.15, 5: 1.35}          # Mon..Sat (closed Sunday)
    ms = {1: 1.15, 2: 1.10, 3: 1.05, 4: 0.90, 5: 0.85, 6: 0.95, 7: 1.00, 8: 1.05, 9: 1.05, 10: 1.00, 11: 1.05, 12: 1.20}
    month_sales = {}
    week_cash, week_mp = 0, 0
    for i, p in enumerate(MONTHS):
        total = 0
        for d in range(1, days_of(p) + 1):
            dt = pd.Timestamp(p.year, p.month, d)
            if dt.weekday() == 6:
                continue
            g = infl(i, 0.01) * ms[p.month] * wd[dt.weekday()] * (1.10 if d >= 25 else 1.0)
            cash = lognorm(14000 * g, 0.22)
            mp = lognorm(9500 * g, 0.22)
            mk(rows, p, d, "Daily cash sales", cash, "INCOME", "Cash Till", "Sales")
            mk(rows, p, d, "Daily M-Pesa till sales", mp, "INCOME", "M-Pesa Till", "Sales")
            total += r5(cash) + r5(mp)
            week_cash += r5(cash); week_mp += r5(mp)
            if dt.weekday() == 5:                                         # Saturday banking
                mk(rows, p, d, "Deposit of cash takings", week_cash * 0.75, "TRANSFER", "Cash Till", "Transfers", to_account="Business Bank Account")
                mk(rows, p, d, "Transfer from till to bank", week_mp * 0.80, "TRANSFER", "M-Pesa Till", "Transfers", to_account="Business Bank Account")
                week_cash = week_mp = 0
        month_sales[i] = total
        for d in sample_days(p, int(rng.poisson(1.0))):
            mk(rows, p, d, "Delivery fee income", lognorm(3500, 0.4), "INCOME", "M-Pesa Till", "Other Income")
        # stock purchases: driven by previous month's sales (autocorrelation)
        base = month_sales.get(i - 1, total) * 0.55 * rng.uniform(0.9, 1.1)
        n = int(rng.integers(6, 10))
        shares = rng.dirichlet(np.ones(n))
        for d, sh in zip(sample_days(p, n, 1.0), shares):
            mk(rows, p, d, pick(["Supplier payment - cement and building materials", "Supplier payment - paints", "Supplier payment - tools and hardware", "Supplier payment - plumbing items", "Supplier payment - electricals"]),
               base * sh, "EXPENSE", pick(["Business Bank Account", "M-Pesa Till"], [0.7, 0.3]), "Stock Purchases")
        fixed_exp(rows, p, 1, "Shop rent", 45000 * (1.04 ** (p.year - 2023)), "Business Bank Account", "Rent")
        raise_f = 1.05 ** max(0, p.year - 2024)
        for desc, amt in [("Salary - shop attendant", 22000), ("Salary - sales assistant", 18000), ("Salary - delivery rider", 15000)]:
            fixed_exp(rows, p, 28, desc, amt * raise_f, "Business Bank Account", "Salaries")
        fixed_exp(rows, p, 9, "Electricity tokens", lognorm(7500, 0.12) * infl(i, 0.003), "M-Pesa Till", "Utilities")
        fixed_exp(rows, p, 11, "Water bill", 1200, "M-Pesa Till", "Utilities")
        variable_exp(rows, p, i, ["Delivery to customer", "Transport of stock", "Fuel for pickup"], ["M-Pesa Till", "Cash Till"], "Transport and Delivery", 6, 2200, 0.6)
        if p.month == 1:
            fixed_exp(rows, p, 12, "Annual single business permit", 38000, "Business Bank Account", "Licenses and Permits")
        if p.month in (3, 6, 9, 12):
            fixed_exp(rows, p, 14, "Fire safety and inspection fees", 4500, "M-Pesa Till", "Licenses and Permits")
        variable_exp(rows, p, i, ["Flyers and posters", "Social media advertising", "Signboard repair"], ["M-Pesa Till"], "Marketing", 1.3, 4500, 0.6, season=1.3 if p.month in (1, 11, 12) else 1.0)
        variable_exp(rows, p, i, ["Shelf repair", "Delivery bike service", "Till and scale repair"], ["Cash Till", "M-Pesa Till"], "Repairs and Maintenance", 0.8, 6500, 0.8)
        for d in sample_days(p, 4):
            mk(rows, p, d, "Bank and mobile money charges", lognorm(850, 0.3), "EXPENSE", "Business Bank Account", "Bank and Mobile Charges")
        variable_exp(rows, p, i, ["Packaging bags", "Receipt books and stationery", "Cleaning supplies"], ["Cash Till", "M-Pesa Till"], "Packaging and Supplies", 2, 3200, 0.5)
        fixed_exp(rows, p, 30, "Owner drawings", 40000 * (1.03 ** (p.year - 2023)), "Business Bank Account", "Owner Drawings")
        variable_exp(rows, p, i, ["Tea and refreshments", "Small shop expense", "Security tip"], ["Cash Till"], "Miscellaneous", 2, 1500, 0.8)
    return pd.DataFrame(rows)


# ----------------------------------------------------------------- ORGANIZATION
def organization():
    rows = []
    prog = {1: 0.8, 2: 1.1, 3: 1.2, 4: 1.15, 5: 1.2, 6: 1.1, 7: 0.9, 8: 0.85, 9: 1.15, 10: 1.25, 11: 1.2, 12: 0.7}
    event = {12: 2.2, 6: 1.5, 3: 1.3, 8: 1.2}
    PR, EV, AD, IT = "Programs", "Events and Outreach", "Administration", "Finance and ICT"
    for i, p in enumerate(MONTHS):
        ps, es = prog[p.month], event.get(p.month, 0.8)
        if p.month in (1, 4, 7, 10):
            mk(rows, p, 5, "Quarterly grant instalment", lognorm(1800000, 0.08), "INCOME", "Main Bank Account", "Grants")
        for d in sample_days(p, int(rng.integers(2, 5))):
            mk(rows, p, d, pick(["Individual donation", "Corporate donation", "Well-wisher contribution"]), lognorm(25000, 0.8), "INCOME", pick(["Main Bank Account", "M-Pesa Paybill"]), "Donations")
        for d in sample_days(p, 12):
            mk(rows, p, d, "Membership fees collected", lognorm(5000, 0.35), "INCOME", "M-Pesa Paybill", "Membership Fees")
        if p.month in (6, 12):
            mk(rows, p, 20, "Fundraising dinner proceeds", lognorm(150000, 0.2), "INCOME", "Main Bank Account", "Fundraising")
        mk(rows, p, 28, "Paybill funds to main account", 50000, "TRANSFER", "M-Pesa Paybill", "Transfers", to_account="Main Bank Account")
        mk(rows, p, 3, "Petty cash top-up", 20000, "TRANSFER", "Main Bank Account", "Transfers", to_account="Petty Cash")
        variable_exp(rows, p, i, ["Training manuals and handouts", "Stationery for sessions"], ["Main Bank Account", "M-Pesa Paybill"], "Training Materials", 3, 6000, 0.5, ps, dept=PR)
        variable_exp(rows, p, i, ["Facilitator fee"], ["Main Bank Account"], "Facilitator Fees", 4, 12000, 0.35, ps, dept=PR)
        variable_exp(rows, p, i, ["Participant allowance", "Participant meals"], ["M-Pesa Paybill", "Main Bank Account"], "Participant Support", 5, 5500, 0.4, ps, dept=PR)
        variable_exp(rows, p, i, ["Hall hire for training"], ["Main Bank Account"], "Venue Hire", 2, 15000, 0.3, ps, dept=PR)
        variable_exp(rows, p, i, ["Field transport for programs"], ["Main Bank Account", "Petty Cash"], "Transport", 5, 2800, 0.5, ps, dept=PR)
        variable_exp(rows, p, i, ["Event venue booking"], ["Main Bank Account"], "Venue Hire", 1.2, 25000, 0.6, es, dept=EV)
        variable_exp(rows, p, i, ["Event catering"], ["Main Bank Account"], "Catering", 2, 18000, 0.6, es, dept=EV)
        variable_exp(rows, p, i, ["Banners and printing", "Event publicity"], ["Main Bank Account", "M-Pesa Paybill"], "Printing and Publicity", 2, 9000, 0.5, es, dept=EV)
        variable_exp(rows, p, i, ["Outreach transport"], ["Main Bank Account", "Petty Cash"], "Transport", 3, 3500, 0.5, es, dept=EV)
        raise_f = 1.05 ** max(0, p.year - 2024)
        for desc, amt in [("Salary - programs coordinator", 65000), ("Salary - finance officer", 48000), ("Salary - administrator", 40000), ("Salary - assistant", 32000)]:
            fixed_exp(rows, p, 28, desc, amt * raise_f, "Main Bank Account", "Salaries", AD)
        fixed_exp(rows, p, 1, "Office rent", 55000 * (1.04 ** (p.year - 2023)), "Main Bank Account", "Rent", AD)
        fixed_exp(rows, p, 9, "Electricity tokens", lognorm(6500, 0.1), "Main Bank Account", "Utilities", AD)
        fixed_exp(rows, p, 10, "Water bill", 1800, "Main Bank Account", "Utilities", AD)
        variable_exp(rows, p, i, ["Office stationery", "Cleaning supplies", "Printer toner"], ["Petty Cash", "Main Bank Account"], "Office Supplies", 2, 5500, 0.4, dept=AD)
        if p.month == 1:
            fixed_exp(rows, p, 12, "Annual insurance premium", 85000, "Main Bank Account", "Audit and Compliance", AD)
        if p.month == 3:
            fixed_exp(rows, p, 14, "Annual external audit fee", 120000, "Main Bank Account", "Audit and Compliance", AD)
        variable_exp(rows, p, i, ["Accounting software subscription", "Cloud storage subscription"], ["Main Bank Account"], "Software and Subscriptions", 2, 7500, 0.3, dept=IT)
        variable_exp(rows, p, i, ["Laptop", "Projector", "Router and cabling"], ["Main Bank Account"], "Equipment", 0.5, 60000, 0.7, dept=IT)
        fixed_exp(rows, p, 11, "Internet and website hosting", 6000, "Main Bank Account", "Software and Subscriptions", IT)
        for d in sample_days(p, 4):
            mk(rows, p, d, "Bank and Paybill charges", lognorm(1200, 0.3), "EXPENSE", "Main Bank Account", "Bank Charges", IT)
        variable_exp(rows, p, i, ["Small miscellaneous expense"], ["Petty Cash"], "Miscellaneous", 2, 1800, 0.7, dept=AD)
    return pd.DataFrame(rows)


# ----------------------------------------------------------------- anomaly injection
FIXED = {"Rent", "Salaries", "Owner Drawings", "Savings", "Transfers", "Licenses and Permits", "Audit and Compliance"}


def inject(df, kind, small_cats, round_range, unusual_range, unusual_desc, dept_for_burst=""):
    df = df.copy().reset_index(drop=True)
    df["anomaly_type"] = "NONE"
    exp = df[(df.type == "EXPENSE") & (~df.category.isin(FIXED))]
    n_target = int(len(df[df.type == "EXPENSE"]) * ANOMALY_RATE)
    mix = {"LARGE_AMOUNT": 0.40, "DUPLICATE": 0.20, "ROUND_LARGE_CASH": 0.15, "FREQUENCY_BURST": 0.15, "UNUSUAL_CATEGORY": 0.10}
    new_rows = []
    idx_pool = list(exp.index)
    rng.shuffle(idx_pool)
    used = set()

    def take():
        while True:
            j = idx_pool.pop()
            if j not in used:
                used.add(j)
                return j

    for _ in range(int(n_target * mix["LARGE_AMOUNT"])):
        j = take()
        df.loc[j, "amount"] = r5(df.loc[j, "amount"] * rng.uniform(3.5, 9.0))
        df.loc[j, "anomaly_type"] = "LARGE_AMOUNT"
    for _ in range(int(n_target * mix["DUPLICATE"])):
        j = take()
        row = df.loc[j].to_dict()
        row["anomaly_type"] = "DUPLICATE"
        new_rows.append(row)
    for _ in range(int(n_target * mix["ROUND_LARGE_CASH"])):
        d = pd.Timestamp(rng.choice(pd.date_range("2024-01-01", "2026-10-28")))
        acct = {"personal": "M-Pesa", "business": "Cash Till", "organization": "Petty Cash"}[kind]
        new_rows.append(dict(date=d, description="Cash withdrawal", amount=int(rng.integers(*round_range) // 5000 * 5000), type="EXPENSE", account=acct,
                             to_account="", category="Miscellaneous", department=dept_for_burst, anomaly_type="ROUND_LARGE_CASH"))
    n_burst = max(1, int(n_target * mix["FREQUENCY_BURST"] / 7))
    for _ in range(n_burst):
        d = pd.Timestamp(rng.choice(pd.date_range("2024-01-01", "2026-10-28")))
        cat, desc, acct, dept = small_cats[int(rng.integers(len(small_cats)))]
        for _k in range(int(rng.integers(6, 10))):
            new_rows.append(dict(date=d, description=desc, amount=r5(lognorm(600, 0.3)), type="EXPENSE", account=acct, to_account="", category=cat,
                                 department=dept, anomaly_type="FREQUENCY_BURST"))
    for _ in range(max(1, int(n_target * mix["UNUSUAL_CATEGORY"]))):
        d = pd.Timestamp(rng.choice(pd.date_range("2024-01-01", "2026-10-28")))
        acct = {"personal": "M-Pesa", "business": "M-Pesa Till", "organization": "Main Bank Account"}[kind]
        new_rows.append(dict(date=d, description=unusual_desc, amount=int(rng.integers(*unusual_range) // 500 * 500), type="EXPENSE", account=acct,
                             to_account="", category="Miscellaneous", department=dept_for_burst, anomaly_type="UNUSUAL_CATEGORY"))
    if new_rows:
        df = pd.concat([df, pd.DataFrame(new_rows)], ignore_index=True)
    df = df.sort_values(["date"], kind="stable").reset_index(drop=True)
    return df


def finish(df, prefix):
    df = df.copy()
    df["ref"] = [f"{prefix}-{i + 1:06d}" for i in range(len(df))]
    df["date"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")
    return df


# ----------------------------------------------------------------- build
def main():
    out = {}
    out["PERSONAL"] = finish(inject(personal(), "personal", [("Airtime and Data", "Mobile airtime", "M-Pesa", ""), ("Transport", "Boda boda ride", "M-Pesa", "")], (30000, 60000), (8000, 25000), "Unrecognized charge"), "PER")
    out["BUSINESS"] = finish(inject(business(), "business", [("Bank and Mobile Charges", "Bank and mobile money charges", "Business Bank Account", ""), ("Transport and Delivery", "Delivery to customer", "M-Pesa Till", "")], (80000, 150000), (60000, 120000), "Unrecognized supplier"), "BUS")
    out["ORGANIZATION"] = finish(inject(organization(), "organization", [("Office Supplies", "Office stationery", "Petty Cash", "Administration"), ("Transport", "Outreach transport", "Petty Cash", "Events and Outreach")], (100000, 250000), (150000, 300000), "Payment to unregistered vendor", "Administration"), "ORG")
    files = {"PERSONAL": "transactions_personal.csv", "BUSINESS": "transactions_business.csv", "ORGANIZATION": "transactions_organization.csv"}
    for w, df in out.items():
        df[COLS].to_csv(files[w], index=False)

    labels = pd.concat([pd.DataFrame({"ref": df.ref, "workspace_type": w, "is_anomaly": (df.anomaly_type != "NONE").astype(int), "anomaly_type": df.anomaly_type}) for w, df in out.items()])
    labels.to_csv("anomaly_labels.csv", index=False)

    # monthly series for forecasting
    ser = []
    for w, df in out.items():
        e = df[df.type == "EXPENSE"].copy()
        e["month"] = pd.to_datetime(e["date"]).dt.to_period("M").dt.to_timestamp().dt.strftime("%Y-%m-01")
        e["clean"] = np.where(e.anomaly_type == "NONE", e.amount, 0)
        e["cnt_clean"] = (e.anomaly_type == "NONE").astype(int)
        levels = [("TOTAL", lambda d: pd.Series("ALL EXPENSES", index=d.index)), ("CATEGORY", lambda d: d.category)]
        if w == "ORGANIZATION":
            levels.append(("DEPARTMENT", lambda d: d.department))
        for lvl, f in levels:
            g = e.assign(name=f(e)).groupby(["name", "month"]).agg(total_expense=("amount", "sum"), total_expense_excl_anomalies=("clean", "sum"), txn_count=("amount", "size")).reset_index()
            allm = [m.to_timestamp().strftime("%Y-%m-01") for m in MONTHS]
            full = pd.MultiIndex.from_product([g.name.unique(), allm], names=["name", "month"])
            g = g.set_index(["name", "month"]).reindex(full, fill_value=0).reset_index()
            g.insert(0, "level", lvl)
            g.insert(0, "workspace_type", w)
            ser.append(g)
    series = pd.concat(ser)[["workspace_type", "level", "name", "month", "total_expense", "total_expense_excl_anomalies", "txn_count"]]
    series.to_csv("monthly_expense_series.csv", index=False)

    # budgets (monthly), derived from clean monthly totals with planning error
    bud = []
    s = series[series.level.isin(["CATEGORY", "DEPARTMENT"])]
    for _, r in s.iterrows():
        if r.total_expense_excl_anomalies <= 0:
            continue
        w, lvl = r.workspace_type, r.level
        if w == "ORGANIZATION" and lvl == "CATEGORY":
            continue                                                  # organization budgets are set per department
        if w != "ORGANIZATION" and r["name"] in ("Rent", "Salaries", "Owner Drawings"):
            pass
        limit = int(np.ceil(r.total_expense_excl_anomalies * rng.uniform(0.92, 1.15) / 500.0) * 500)
        start = pd.Timestamp(r.month)
        end = start + pd.offsets.MonthEnd(0)
        bud.append(dict(workspace_type=w, category=(r["name"] if lvl == "CATEGORY" else ""), department=(r["name"] if lvl == "DEPARTMENT" else ""),
                        period_start=start.strftime("%Y-%m-%d"), period_end=end.strftime("%Y-%m-%d"), amount_limit=limit, alert_threshold=80))
    pd.DataFrame(bud).to_csv("budgets.csv", index=False)

    # reference data
    pd.DataFrame([
        ("PERSONAL", "Bank Account", "BANK", 120000), ("PERSONAL", "M-Pesa", "MOBILE_MONEY", 15000), ("PERSONAL", "Cash", "CASH", 4000), ("PERSONAL", "Savings Account", "BANK", 60000),
        ("BUSINESS", "Cash Till", "CASH", 25000), ("BUSINESS", "M-Pesa Till", "MOBILE_MONEY", 40000), ("BUSINESS", "Business Bank Account", "BANK", 350000),
        ("ORGANIZATION", "Main Bank Account", "BANK", 1500000), ("ORGANIZATION", "Petty Cash", "CASH", 20000), ("ORGANIZATION", "M-Pesa Paybill", "MOBILE_MONEY", 35000),
    ], columns=["workspace_type", "account_name", "account_type", "opening_balance"]).to_csv("accounts.csv", index=False)
    cat_rows = []
    for w, df in out.items():
        for c, t in df[df.type.isin(["INCOME", "EXPENSE"])].groupby("category").type.first().items():
            cat_rows.append((w, c, t))
    pd.DataFrame(cat_rows, columns=["workspace_type", "category_name", "category_type"]).sort_values(["workspace_type", "category_type", "category_name"]).to_csv("categories.csv", index=False)
    pd.DataFrame({"workspace_type": "ORGANIZATION", "department_name": ["Programs", "Events and Outreach", "Administration", "Finance and ICT"]}).to_csv("departments.csv", index=False)
    pd.DataFrame([("PERSONAL", "Laptop fund", 90000, 56000, "2027-03-31"), ("PERSONAL", "Emergency fund", 200000, 70000, "2027-12-31"), ("PERSONAL", "Holiday trip", 60000, 12000, "2027-06-30")],
                 columns=["workspace_type", "goal_name", "target_amount", "saved_amount", "target_date"]).to_csv("savings_goals.csv", index=False)

    for w, df in out.items():
        print(w, len(df), "rows;", int((df.anomaly_type != "NONE").sum()), "anomalies;", df.date.min(), "to", df.date.max())


if __name__ == "__main__":
    main()
