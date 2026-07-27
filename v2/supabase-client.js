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
var SUPABASE_URL = "";
var SUPABASE_ANON_KEY = "";
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

  return {
    isConfigured: isConfigured,
    getClient: getClient,
    getCompanyId: getCompanyId,
    getStoreId: getStoreId,
    findEmployeeByCard: findEmployeeByCard,
    findEmployeeByName: findEmployeeByName,
    fetchAllCards: fetchAllCards,
    registerCard: registerCard,
    insertPunch: insertPunch
  };
})();
