/*
  TORIYAMA-iS / 店舗管理-iS 共通 Supabase 接続設定。
  各ページの <script src=".../supabase-client.js"> の前に、
  必ず下記CDNを読み込むこと:
    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>

  ここにプロジェクトURLとanonキーを貼るとSupabase接続が有効になる。
  空のままなら isConfigured() が false を返し、各ページはlocalStorage/
  仮データにフォールバックする（今のv2の動作と同じ）。

  取得方法: Supabaseダッシュボード → Project Settings → API
    - Project URL          → SUPABASE_URL
    - anon / public キー   → SUPABASE_ANON_KEY

  マルチテナント運用について:
    1つのSupabaseプロジェクトに複数の顧客企業（会社）を同居させる設計のため、
    このサイトのビルドごとに COMPANY_CODE を変えて配布する（例: 鳥やま向けビルドは
    "toriyama"、次の顧客向けビルドは別のcodeを持つ別サイトとして書き出す）。

  ★重要：これは「区分け」であって「セキュリティ」ではない。
    今のschema.sqlのRLSはデモ用に緩い設定（company_idが合っていればanonキーで
    誰でも読み書き可）なので、ブラウザの開発者ツールでCOMPANY_CODEを書き換えれば
    理屈上は他社のデータにも触れてしまう。本番で2社目の顧客が乗る前に、
    Supabase Auth（またはEdge Functions経由の検証）でcompany_idをサーバー側の
    検証済みクレームから取るポリシーに必ず差し替えること（schema.sql末尾にひな形あり）。
*/
var SUPABASE_URL = "https://qzsxscyvidihltvfzouc.supabase.co";
var SUPABASE_ANON_KEY = "sb_publishable_M1Jq2Fmql_3YQ7d0d9rxGw_Eslf7URO";
var COMPANY_CODE = "toriyama";

var TORIYAMA_DB = (function () {
  var client = null;
  var companyIdCacheKey = "toriyama_company_id_" + COMPANY_CODE;

  function isConfigured() {
    return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
  }

  function getClient() {
    if (!isConfigured()) { return null; }
    if (!client && window.supabase) {
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return client;
  }

  // このビルドが属する会社のIDを解決（初回のみ問い合わせ、以後はローカルにキャッシュ）
  async function getCompanyId() {
    var cached = localStorage.getItem(companyIdCacheKey);
    if (cached) { return cached; }
    var c = getClient();
    if (!c) { return null; }
    var res = await c.from("companies").select("id").eq("code", COMPANY_CODE).maybeSingle();
    if (res.data) {
      localStorage.setItem(companyIdCacheKey, res.data.id);
      return res.data.id;
    }
    return null;
  }

  // 店舗コードから店舗IDを解決（会社スコープ内で検索）
  async function getStoreId(storeCode) {
    var cacheKey = "toriyama_store_id_" + COMPANY_CODE + "_" + storeCode;
    var cached = localStorage.getItem(cacheKey);
    if (cached) { return cached; }
    var c = getClient();
    var companyId = await getCompanyId();
    if (!c || !companyId) { return null; }
    var res = await c.from("stores").select("id").eq("company_id", companyId).eq("code", storeCode).maybeSingle();
    if (res.data) {
      localStorage.setItem(cacheKey, res.data.id);
      return res.data.id;
    }
    return null;
  }

  // カードIDから従業員を検索（自社スコープ内のみ）。見つからなければ null。
  async function findEmployeeByCard(cardId) {
    var c = getClient();
    var companyId = await getCompanyId();
    if (!c || !companyId) { return null; }
    var res = await c
      .from("ic_cards")
      .select("employee_id, employees(id, name, role)")
      .eq("company_id", companyId)
      .eq("card_id", cardId)
      .maybeSingle();
    if (res.error || !res.data) { return null; }
    return res.data.employees;
  }

  // 新規カードを従業員に紐付け
  async function registerCard(cardId, employeeId) {
    var c = getClient();
    var companyId = await getCompanyId();
    if (!c || !companyId) { return { error: "not_configured" }; }
    return await c.from("ic_cards").insert({ card_id: cardId, employee_id: employeeId, company_id: companyId });
  }

  // 会社スコープ内で従業員を名前検索（登録画面用）
  async function findEmployeeByName(name) {
    var c = getClient();
    var companyId = await getCompanyId();
    if (!c || !companyId) { return null; }
    var res = await c.from("employees").select("id, name, role").eq("company_id", companyId).eq("name", name).maybeSingle();
    return res.data || null;
  }

  // 会社の全店舗一覧を取得（id, name, code）。STAFF登録の店舗表示など、
  // 店舗名⇔店舗IDの変換が必要な画面で使う。
  async function fetchAllStores() {
    var c = getClient();
    var companyId = await getCompanyId();
    if (!c || !companyId) { return []; }
    var res = await c.from("stores").select("id, name, code").eq("company_id", companyId);
    return res.data || [];
  }

  // 在籍中（active=true）の全従業員を取得（STAFF登録一覧・名前プルダウン用）
  async function fetchAllEmployees() {
    var c = getClient();
    var companyId = await getCompanyId();
    if (!c || !companyId) { return []; }
    var res = await c.from("employees")
      .select("id, name, role, home_store_id, birth_date, hire_date, gender, photo_url")
      .eq("company_id", companyId)
      .eq("active", true);
    return res.data || [];
  }

  // 従業員を新規登録（STAFF登録画面用）
  async function addEmployee(person) {
    var c = getClient();
    var companyId = await getCompanyId();
    if (!c || !companyId) { return { error: "not_configured" }; }
    return await c.from("employees").insert({
      company_id: companyId,
      name: person.name,
      role: person.employmentType,
      home_store_id: person.storeId || null,
      birth_date: person.birthDate || null,
      hire_date: person.hireDate || null,
      gender: person.gender || null,
      photo_url: person.photo || null,
      active: true
    }).select();
  }

  // 従業員を解除（打刻・勤怠の過去データを残すため、削除ではなくactive=falseにする論理削除）
  async function deactivateEmployee(employeeId) {
    var c = getClient();
    var companyId = await getCompanyId();
    if (!c || !companyId) { return { error: "not_configured" }; }
    return await c.from("employees").update({ active: false }).eq("id", employeeId).eq("company_id", companyId);
  }

  // 全ICカード台帳を取得（オフラインキャッシュ更新用）
  async function fetchAllCards() {
    var c = getClient();
    var companyId = await getCompanyId();
    if (!c || !companyId) { return []; }
    var res = await c.from("ic_cards").select("card_id, employees(id, name)").eq("company_id", companyId);
    return res.data || [];
  }

  // 打刻を1件保存
  async function insertPunch(employeeId, storeId, type, punchedAtIso, source) {
    var c = getClient();
    var companyId = await getCompanyId();
    if (!c || !companyId) { return { error: "not_configured" }; }
    return await c.from("punches").insert({
      company_id: companyId,
      employee_id: employeeId,
      store_id: storeId,
      type: type,
      punched_at: punchedAtIso,
      source: source || "card"
    });
  }

  // 複数の従業員IDについて、指定した年月の確定シフトをまとめて取得
  // （shift-confirm.html / admin-shift.html / 個人の勤怠確認・勤怠確認 で使用）
  async function fetchConfirmedShifts(employeeIds, year, month) {
    var c = getClient();
    var companyId = await getCompanyId();
    if (!c || !companyId || !employeeIds || !employeeIds.length) { return []; }
    var startDate = year + "-" + String(month).padStart(2, "0") + "-01";
    var nextMonthDate = (month === 12) ? (year + 1) + "-01-01" : year + "-" + String(month + 1).padStart(2, "0") + "-01";
    var res = await c.from("shift_confirmed")
      .select("employee_id, work_date, start_time, end_time, is_off")
      .eq("company_id", companyId)
      .in("employee_id", employeeIds)
      .gte("work_date", startDate)
      .lt("work_date", nextMonthDate);
    return res.data || [];
  }

  // 確定シフトをまとめて書き込む（1人1日=1行。同じemployee_id+work_dateは上書き）
  // rows: [{ employeeId, storeId, workDate, startTime, endTime, isOff }, ...]
  async function bulkUpsertConfirmedShifts(rows) {
    var c = getClient();
    var companyId = await getCompanyId();
    if (!c || !companyId) { return { error: "not_configured" }; }
    if (!rows || !rows.length) { return { error: null }; }
    var payload = rows.map(function (r) {
      return {
        company_id: companyId,
        employee_id: r.employeeId,
        store_id: r.storeId,
        work_date: r.workDate,
        start_time: r.startTime || null,
        end_time: r.endTime || null,
        is_off: !!r.isOff
      };
    });
    return await c.from("shift_confirmed").upsert(payload, { onConflict: "employee_id,work_date" }).select();
  }

  // 複数の従業員IDについて、指定した年月の希望シフトをまとめて取得（shift-submit.html / admin-shift.htmlで使用）
  async function fetchShiftRequests(employeeIds, year, month) {
    var c = getClient();
    var companyId = await getCompanyId();
    if (!c || !companyId || !employeeIds || !employeeIds.length) { return []; }
    var startDate = year + "-" + String(month).padStart(2, "0") + "-01";
    var nextMonthDate = (month === 12) ? (year + 1) + "-01-01" : year + "-" + String(month + 1).padStart(2, "0") + "-01";
    var res = await c.from("shift_requests")
      .select("employee_id, work_date, start_time, end_time, is_off")
      .eq("company_id", companyId)
      .in("employee_id", employeeIds)
      .gte("work_date", startDate)
      .lt("work_date", nextMonthDate);
    return res.data || [];
  }

  // 希望シフトをまとめて書き込む（1人1日=1行。同じemployee_id+work_dateは上書き）
  async function bulkUpsertShiftRequests(rows) {
    var c = getClient();
    var companyId = await getCompanyId();
    if (!c || !companyId) { return { error: "not_configured" }; }
    if (!rows || !rows.length) { return { error: null }; }
    var payload = rows.map(function (r) {
      return {
        company_id: companyId,
        employee_id: r.employeeId,
        store_id: r.storeId,
        work_date: r.workDate,
        start_time: r.startTime || null,
        end_time: r.endTime || null,
        is_off: !!r.isOff
      };
    });
    return await c.from("shift_requests").upsert(payload, { onConflict: "employee_id,work_date" }).select();
  }

  return {
    isConfigured: isConfigured,
    getClient: getClient,
    getCompanyId: getCompanyId,
    getStoreId: getStoreId,
    findEmployeeByCard: findEmployeeByCard,
    findEmployeeByName: findEmployeeByName,
    fetchAllCards: fetchAllCards,
    registerCard: registerCard,
    insertPunch: insertPunch,
    fetchAllStores: fetchAllStores,
    fetchAllEmployees: fetchAllEmployees,
    addEmployee: addEmployee,
    deactivateEmployee: deactivateEmployee,
    fetchConfirmedShifts: fetchConfirmedShifts,
    bulkUpsertConfirmedShifts: bulkUpsertConfirmedShifts,
    fetchShiftRequests: fetchShiftRequests,
    bulkUpsertShiftRequests: bulkUpsertShiftRequests
  };
})();
