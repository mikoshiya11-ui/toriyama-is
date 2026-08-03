/*
  TORIYAMA-iS シフト機能で共通利用する日付・時刻ユーティリティ。
  admin-shift.html（管理者：月表示ガント）と shift-confirm.html（スタッフ：確定確認）で共有する。

  スタッフ一覧について（2026/07/30〜）:
    以前はここに架空のバイト・社員名をハードコードしていたが、STAFF登録
    （admin-staff.html）で管理する実データ（toriyama_staff_roster）に一本化した。
    このファイルを読み込むページは、必ず先に ../staff-utils.js も読み込むこと
    （getStaffRoster() を使うため）。
*/
var SHIFT_DAYS = ["月", "火", "水", "木", "金", "土", "日"];

// 会社の全店舗一覧（店舗選択プルダウン等で使う固定リスト）
// 2026/08/01〜: 鳥山社長要望により、Tripot cafe FOOD truck ①・②はスタッフ共有のため
// 「Tripot cafe FOOD truck」1つに統合。新たに「本部」（事務員・CK）を追加。
var STORE_LIST = [
  "餃子酒場さんちょうめ",
  "鳥料理と炭火焼 鶏やま",
  "Tripot cafe BAKE stand",
  "Tripot cafe FOOD truck",
  "本部"
];

// 店舗名 → Supabase stores.code の対応（打刻端末の店舗設定などで使う）
var STORE_CODE_MAP = {
  "餃子酒場さんちょうめ": "sanchome",
  "鳥料理と炭火焼 鶏やま": "keiyama",
  "Tripot cafe BAKE stand": "tripot-bake",
  "Tripot cafe FOOD truck": "tripot-truck",
  "本部": "honbu"
};

// 店舗ごとのガントバー色（デフォルト。Supabase側のstores.colorが設定されていればそちらを優先する。
// 2026/08/03〜: シフト管理画面で「店舗ごとに色を変える」「右クリックで変更できる」要望に対応）
var DEFAULT_STORE_COLORS = {
  "sanchome": "#b5482e",
  "keiyama": "#2f6f4f",
  "tripot-bake": "#8a6d3b",
  "tripot-truck": "#3b5b8a",
  "honbu": "#6b4c8a"
};

function defaultStoreColor(storeName) {
  var code = (typeof STORE_CODE_MAP !== "undefined") ? STORE_CODE_MAP[storeName] : null;
  return (code && DEFAULT_STORE_COLORS[code]) || "#111111";
}

var storeColorsCacheKey = "toriyama_store_colors";

function readStoreColorsCache() {
  try { return JSON.parse(localStorage.getItem(storeColorsCacheKey) || "{}"); }
  catch (e) { return {}; }
}

function writeStoreColorsCache(map) {
  localStorage.setItem(storeColorsCacheKey, JSON.stringify(map));
}

// Supabase側の店舗色設定（stores.color）を取得し、ローカルキャッシュ（店舗名→色）を更新する
async function syncStoreColorsFromSupabase() {
  if (typeof TORIYAMA_DB === "undefined" || !TORIYAMA_DB.isConfigured()) { return false; }
  var stores = await TORIYAMA_DB.fetchAllStores();
  if (stores === null) { return false; }
  var map = {};
  stores.forEach(function (s) { map[s.name] = s.color || defaultStoreColor(s.name); });
  writeStoreColorsCache(map);
  return true;
}

// 店舗の現在の色を取得（未設定・未同期ならデフォルト配色にフォールバック）
function getStoreColor(storeName) {
  var cache = readStoreColorsCache();
  return cache[storeName] || defaultStoreColor(storeName);
}

// 店舗の色を変更する（ガントバー右クリックの色変更メニューから使用）
async function setStoreColor(storeName, color) {
  var cache = readStoreColorsCache();
  cache[storeName] = color;
  writeStoreColorsCache(cache);
  if (typeof TORIYAMA_DB === "undefined" || !TORIYAMA_DB.isConfigured()) { return { ok: true }; }
  var code = (typeof STORE_CODE_MAP !== "undefined") ? STORE_CODE_MAP[storeName] : null;
  var storeId = code ? await TORIYAMA_DB.getStoreId(code) : null;
  if (!storeId) { return { error: "store_not_found" }; }
  var res = await TORIYAMA_DB.updateStoreColor(storeId, color);
  if (res.error) { return { error: res.error }; }
  return { ok: true };
}

// 雇用形態一覧（2026/08/03〜: 契約社員・役員を追加）。表示順・一覧内の並び順はこの配列順。
var EMPLOYMENT_TYPES = [
  { value: "yakuin", label: "役員" },
  { value: "shain", label: "社員" },
  { value: "keiyaku", label: "契約社員" },
  { value: "baito", label: "バイト" },
  { value: "temp", label: "臨時" }
];

function employmentLabel(t) {
  var found = EMPLOYMENT_TYPES.filter(function (e) { return e.value === t; })[0];
  return found ? found.label : "";
}

// 名前一覧プルダウン等で使う「（社員）」のような雇用形態のサフィックス表示
function employmentSuffixLabel(name) {
  var roster = (typeof getStaffRoster === "function") ? getStaffRoster() : [];
  var person = roster.filter(function (p) { return p.name === name; })[0];
  var label = person ? employmentLabel(person.employmentType) : "";
  return label ? "（" + label + "）" : "";
}

function employmentPriority(t) {
  var idx = EMPLOYMENT_TYPES.map(function (e) { return e.value; }).indexOf(t);
  return idx === -1 ? EMPLOYMENT_TYPES.length : idx;
}

// 従業員が指定店舗で勤務できるか（掛け持ち対応。stores配列が無い旧データはstoreを1件のみとして扱う）
function staffWorksAt(person, store) {
  var stores = person.stores || (person.store ? [person.store] : []);
  return stores.indexOf(store) !== -1;
}

// 指定店舗の在籍スタッフ名一覧をSTAFF登録データから取得（役員・社員・契約社員・バイトの順）
function getStoreStaffNames(store) {
  var roster = (typeof getStaffRoster === "function") ? getStaffRoster() : [];
  var inStore = roster.filter(function (p) { return staffWorksAt(p, store); });
  inStore.sort(function (a, b) { return employmentPriority(a.employmentType) - employmentPriority(b.employmentType); });
  return inStore.map(function (p) { return p.name; });
}

// 後方互換のために残す（「社員かどうか」の二値判定。新規コードではemploymentSuffixLabel推奨）
function isShain(name) {
  var roster = (typeof getStaffRoster === "function") ? getStaffRoster() : [];
  var person = roster.filter(function (p) { return p.name === name; })[0];
  return !!(person && person.employmentType === "shain");
}

// JSのgetDay()（0=日〜6=土）を、SHIFT_DAYS配列のindex（0=月〜6=日）に変換
function jsDayToShiftIndex(jsDay) {
  return (jsDay + 6) % 7;
}

function pad2(n) {
  return ("0" + n).slice(-2);
}

// year, monthIndex(0始まり) からその月の日数を取得
function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

// "2026-08" のような月キー
function monthKey(year, monthIndex) {
  return year + "-" + pad2(monthIndex + 1);
}

// "2026-08-03" のような日付キー
function dateKey(year, monthIndex, day) {
  return monthKey(year, monthIndex) + "-" + pad2(day);
}

// 月キーの見出し表示用（例: "2026年8月"）
function monthLabel(year, monthIndex) {
  return year + "年" + (monthIndex + 1) + "月";
}

/*
  日本の祝日判定（シフト管理画面の日付BOX色分け用。2026/08/03〜）。
  春分の日・秋分の日は国立天文台の発表を待たないと確定しないため、広く使われている
  近似計算式（1980〜2099年で妥当）で概算している。振替休日は「前日が祝日かつ日曜」
  の単純な1日分だけを見る簡易実装（ゴールデンウィークの祝日連続による多重振替のような
  稀なケースは考慮していない）。実務上の目安表示であり、法的な確定情報ではない点に注意。
*/
function nthMondayOfMonth(year, monthIndex, n) {
  var firstDow = new Date(year, monthIndex, 1).getDay(); // 0=日,1=月,...
  var firstMonday = 1 + ((8 - firstDow) % 7);
  return firstMonday + (n - 1) * 7;
}

function vernalEquinoxDay(year) {
  return Math.floor(20.8431 + 0.242194 * (year - 1980)) - Math.floor((year - 1980) / 4);
}

function autumnalEquinoxDay(year) {
  return Math.floor(23.2488 + 0.242194 * (year - 1980)) - Math.floor((year - 1980) / 4);
}

// 振替休日を含まない「元々の」祝日名（無ければnull）
function fixedHolidayName(year, monthIndex, day) {
  if (monthIndex === 0 && day === 1) { return "元日"; }
  if (monthIndex === 0 && day === nthMondayOfMonth(year, 0, 2)) { return "成人の日"; }
  if (monthIndex === 1 && day === 11) { return "建国記念の日"; }
  if (monthIndex === 1 && day === 23) { return "天皇誕生日"; }
  if (monthIndex === 2 && day === vernalEquinoxDay(year)) { return "春分の日"; }
  if (monthIndex === 3 && day === 29) { return "昭和の日"; }
  if (monthIndex === 4 && day === 3) { return "憲法記念日"; }
  if (monthIndex === 4 && day === 4) { return "みどりの日"; }
  if (monthIndex === 4 && day === 5) { return "こどもの日"; }
  if (monthIndex === 6 && day === nthMondayOfMonth(year, 6, 3)) { return "海の日"; }
  if (monthIndex === 7 && day === 11) { return "山の日"; }
  if (monthIndex === 8 && day === nthMondayOfMonth(year, 8, 3)) { return "敬老の日"; }
  if (monthIndex === 8 && day === autumnalEquinoxDay(year)) { return "秋分の日"; }
  if (monthIndex === 9 && day === nthMondayOfMonth(year, 9, 2)) { return "スポーツの日"; }
  if (monthIndex === 10 && day === 3) { return "文化の日"; }
  if (monthIndex === 10 && day === 23) { return "勤労感謝の日"; }
  return null;
}

// 振替休日込みの祝日名（祝日でなければnull）
function japaneseHolidayName(year, monthIndex, day) {
  var direct = fixedHolidayName(year, monthIndex, day);
  if (direct) { return direct; }
  var prev = new Date(year, monthIndex, day - 1);
  var prevIsHoliday = !!fixedHolidayName(prev.getFullYear(), prev.getMonth(), prev.getDate());
  var prevIsSunday = prev.getDay() === 0;
  if (prevIsHoliday && prevIsSunday) { return "振替休日"; }
  return null;
}

function isJapaneseHoliday(year, monthIndex, day) {
  return !!japaneseHolidayName(year, monthIndex, day);
}

function labelToHour(label) {
  if (!label) { return null; }
  var parts = label.split(":");
  return Number(parts[0]) + Number(parts[1]) / 60;
}

function hourToLabel(h) {
  h = Math.max(0, Math.min(24, h));
  var hh = Math.floor(h);
  var mm = Math.round((h - hh) * 60);
  if (mm === 60) { mm = 0; hh += 1; }
  return pad2(hh) + ":" + pad2(mm);
}

function isSameDate(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/*
  確定シフト（＝勤怠確認画面が参照するデータ）のSupabase同期レイヤー。2026/07/31〜。

  データの持ち方は各画面共通で localStorage の "toriyama_shift_confirmed_month" に
  { 氏名: { "YYYY-MM-DD": { off: true } または { off: false, start: "17:00", end: "23:00" } } }
  という形で入っている（各HTML内の getConfirmed()/saveConfirmedData() が直接読み書きする）。
  ここではその同じキーを外から「Supabaseと同期するための層」として扱う。

  使い方:
    - 画面表示前に await syncConfirmedShiftsFromSupabase(store, year, monthIdx) を呼ぶと、
      その店舗の在籍スタッフ全員分の確定シフトをSupabaseから取得してローカルキャッシュに反映する
      （Supabase未設定時は何もせずfalseを返す＝従来通りローカルのみで動作）。
    - 1件だけ書き込む場合は pushSingleConfirmedShift(store, name, dateKey, entry) を、
      月全体をまとめて書き込む場合は pushConfirmedShiftsToSupabase(store, year, monthIdx, confirmedForStore) を呼ぶ。
      どちらもSupabase未設定時は何もしない（ローカル保存は呼び出し側が別途行う）。
*/
var confirmedShiftStorageKey = "toriyama_shift_confirmed_month";

function readConfirmedShiftsCache() {
  try { return JSON.parse(localStorage.getItem(confirmedShiftStorageKey) || "{}"); }
  catch (e) { return {}; }
}

function writeConfirmedShiftsCache(data) {
  localStorage.setItem(confirmedShiftStorageKey, JSON.stringify(data));
}

// STAFF登録データ（toriyama_staff_roster）から、氏名→SupabaseのemployeeIdを引く
function findEmployeeIdByName(name) {
  var roster = (typeof getStaffRoster === "function") ? getStaffRoster() : [];
  var person = roster.filter(function (p) { return p.name === name; })[0];
  return (person && person.id) ? person.id : null;
}

// "17:00:00"（Postgresのtime型） → "17:00"（画面表示用ラベル）
function hmsToLabel(hms) {
  if (!hms) { return ""; }
  var parts = String(hms).split(":");
  return parts[0] + ":" + parts[1];
}

// 指定店舗の在籍スタッフ全員分・指定年月の確定シフトをSupabaseから取得し、ローカルキャッシュにマージする
async function syncConfirmedShiftsFromSupabase(store, year, monthIdx) {
  if (typeof TORIYAMA_DB === "undefined" || !TORIYAMA_DB.isConfigured()) { return false; }
  if (!store) { return false; }
  var names = getStoreStaffNames(store);
  var idToName = {};
  names.forEach(function (n) {
    var id = findEmployeeIdByName(n);
    if (id) { idToName[id] = n; }
  });
  var employeeIds = Object.keys(idToName);
  if (!employeeIds.length) { return false; }

  try {
    var rows = await TORIYAMA_DB.fetchConfirmedShifts(employeeIds, year, monthIdx + 1);
    var cache = readConfirmedShiftsCache();
    rows.forEach(function (r) {
      var name = idToName[r.employee_id];
      if (!name) { return; }
      if (!cache[name]) { cache[name] = {}; }
      cache[name][r.work_date] = r.is_off ? { off: true } : { off: false, start: hmsToLabel(r.start_time), end: hmsToLabel(r.end_time) };
    });
    writeConfirmedShiftsCache(cache);
    return true;
  } catch (e) {
    return false;
  }
}

// confirmedForStore: { 氏名: { dateKey: {off, start, end} } }（該当店舗の在籍スタッフ分）を
// まとめてSupabaseへ書き込む（admin-shift.htmlの「確定する」ボタンから使用）
async function pushConfirmedShiftsToSupabase(store, year, monthIdx, confirmedForStore) {
  if (typeof TORIYAMA_DB === "undefined" || !TORIYAMA_DB.isConfigured()) { return false; }
  var storeCode = (typeof STORE_CODE_MAP !== "undefined") ? STORE_CODE_MAP[store] : null;
  var storeId = storeCode ? await TORIYAMA_DB.getStoreId(storeCode) : null;
  if (!storeId) { return false; }

  var rows = [];
  Object.keys(confirmedForStore).forEach(function (name) {
    var employeeId = findEmployeeIdByName(name);
    if (!employeeId) { return; }
    var record = confirmedForStore[name];
    Object.keys(record).forEach(function (dKey) {
      var entry = record[dKey];
      rows.push({
        employeeId: employeeId,
        storeId: storeId,
        workDate: dKey,
        startTime: (entry && !entry.off && entry.start) ? entry.start + ":00" : null,
        endTime: (entry && !entry.off && entry.end) ? entry.end + ":00" : null,
        isOff: !!(entry && entry.off)
      });
    });
  });
  if (!rows.length) { return true; }
  var res = await TORIYAMA_DB.bulkUpsertConfirmedShifts(rows);
  return !res.error;
}

// 1日・1人だけを書き込む（個人の勤怠確認・管理者の「修正」から使用）
async function pushSingleConfirmedShift(store, name, dateKey, entry) {
  if (typeof TORIYAMA_DB === "undefined" || !TORIYAMA_DB.isConfigured()) { return false; }
  var employeeId = findEmployeeIdByName(name);
  var storeCode = (typeof STORE_CODE_MAP !== "undefined") ? STORE_CODE_MAP[store] : null;
  var storeId = storeCode ? await TORIYAMA_DB.getStoreId(storeCode) : null;
  if (!employeeId || !storeId) { return false; }

  var res = await TORIYAMA_DB.bulkUpsertConfirmedShifts([{
    employeeId: employeeId,
    storeId: storeId,
    workDate: dateKey,
    startTime: (!entry.off && entry.start) ? entry.start + ":00" : null,
    endTime: (!entry.off && entry.end) ? entry.end + ":00" : null,
    isOff: !!entry.off
  }]);
  return !res.error;
}

/*
  希望シフト（shift-submit.htmlでスタッフが送信する「働ける日」の申請）のSupabase同期レイヤー。

  localStorageのキーは "toriyama_shift_requests_month"、構造は
  { 氏名: { "YYYY-MM-DD": { requested: true/false, start: "17:00", end: "22:00" } } }。
  Supabase側のshift_requestsテーブルとは、requested:true を is_off:false（start/endあり）、
  requested:false を is_off:true（その日は希望なしと明示的に確定した状態）として対応させる。
  まだ一度も触っていない日はSupabaseにも行を作らない（ローカル側も未定義のまま）。
*/
var shiftRequestStorageKey = "toriyama_shift_requests_month";

function readShiftRequestsCache() {
  try { return JSON.parse(localStorage.getItem(shiftRequestStorageKey) || "{}"); }
  catch (e) { return {}; }
}

function writeShiftRequestsCache(data) {
  localStorage.setItem(shiftRequestStorageKey, JSON.stringify(data));
}

// 指定店舗の在籍スタッフ全員分・指定年月の希望シフトをSupabaseから取得し、ローカルキャッシュにマージする
async function syncShiftRequestsFromSupabase(store, year, monthIdx) {
  if (typeof TORIYAMA_DB === "undefined" || !TORIYAMA_DB.isConfigured()) { return false; }
  if (!store) { return false; }
  var names = getStoreStaffNames(store);
  var idToName = {};
  names.forEach(function (n) {
    var id = findEmployeeIdByName(n);
    if (id) { idToName[id] = n; }
  });
  var employeeIds = Object.keys(idToName);
  if (!employeeIds.length) { return false; }

  try {
    var rows = await TORIYAMA_DB.fetchShiftRequests(employeeIds, year, monthIdx + 1);
    var cache = readShiftRequestsCache();
    rows.forEach(function (r) {
      var name = idToName[r.employee_id];
      if (!name) { return; }
      if (!cache[name]) { cache[name] = {}; }
      cache[name][r.work_date] = r.is_off
        ? { requested: false, start: "", end: "", free: false }
        : { requested: true, free: !!r.is_free, start: r.is_free ? "" : hmsToLabel(r.start_time), end: r.is_free ? "" : hmsToLabel(r.end_time) };
    });
    writeShiftRequestsCache(cache);
    return true;
  } catch (e) {
    return false;
  }
}

// 1日・1人分の希望シフトをSupabaseへ書き込む（shift-submit.htmlのsaveDay()から使用）
async function pushSingleShiftRequest(store, name, dateKey, entry) {
  if (typeof TORIYAMA_DB === "undefined" || !TORIYAMA_DB.isConfigured()) { return false; }
  var employeeId = findEmployeeIdByName(name);
  var storeCode = (typeof STORE_CODE_MAP !== "undefined") ? STORE_CODE_MAP[store] : null;
  var storeId = storeCode ? await TORIYAMA_DB.getStoreId(storeCode) : null;
  if (!employeeId || !storeId) { return false; }

  var res = await TORIYAMA_DB.bulkUpsertShiftRequests([{
    employeeId: employeeId,
    storeId: storeId,
    workDate: dateKey,
    startTime: (entry.requested && !entry.free && entry.start) ? entry.start + ":00" : null,
    endTime: (entry.requested && !entry.free && entry.end) ? entry.end + ":00" : null,
    isOff: !entry.requested,
    isFree: !!(entry.requested && entry.free)
  }]);
  return !res.error;
}

/*
  日別目標売上（シフト管理画面・日付の上の入力欄）のSupabase同期レイヤー。2026/08/03〜
  localStorageのキーは "toriyama_sales_targets_month"、構造は { 店舗名: { "YYYY-MM-DD": 金額 } }。
*/
var salesTargetsStorageKey = "toriyama_sales_targets_month";

function readSalesTargetsCache() {
  try { return JSON.parse(localStorage.getItem(salesTargetsStorageKey) || "{}"); }
  catch (e) { return {}; }
}

function writeSalesTargetsCache(data) {
  localStorage.setItem(salesTargetsStorageKey, JSON.stringify(data));
}

// 指定店舗・指定年月の目標売上をSupabaseから取得し、ローカルキャッシュにマージする
async function syncSalesTargetsFromSupabase(store, year, monthIdx) {
  if (typeof TORIYAMA_DB === "undefined" || !TORIYAMA_DB.isConfigured()) { return false; }
  if (!store) { return false; }
  var storeCode = (typeof STORE_CODE_MAP !== "undefined") ? STORE_CODE_MAP[store] : null;
  var storeId = storeCode ? await TORIYAMA_DB.getStoreId(storeCode) : null;
  if (!storeId) { return false; }

  var rows = await TORIYAMA_DB.fetchSalesTargets(storeId, year, monthIdx + 1);
  if (rows === null) { return false; }
  var cache = readSalesTargetsCache();
  if (!cache[store]) { cache[store] = {}; }
  rows.forEach(function (r) { cache[store][r.work_date] = r.target_amount; });
  writeSalesTargetsCache(cache);
  return true;
}

// 1日分の目標売上を保存する（シフト管理画面の入力欄から使用）。
// amountがnull（欄を空にした場合）はSupabase側（NOT NULL制約）へは送らず、ローカル表示だけを空に戻す
async function pushSalesTarget(store, dateKey, amount) {
  var cache = readSalesTargetsCache();
  if (!cache[store]) { cache[store] = {}; }
  cache[store][dateKey] = amount;
  writeSalesTargetsCache(cache);
  if (amount === null) { return true; }
  if (typeof TORIYAMA_DB === "undefined" || !TORIYAMA_DB.isConfigured()) { return true; }
  var storeCode = (typeof STORE_CODE_MAP !== "undefined") ? STORE_CODE_MAP[store] : null;
  var storeId = storeCode ? await TORIYAMA_DB.getStoreId(storeCode) : null;
  if (!storeId) { return false; }
  var res = await TORIYAMA_DB.upsertSalesTarget(storeId, dateKey, amount);
  return !res.error;
}

function getSalesTarget(store, dateKey) {
  var cache = readSalesTargetsCache();
  return (cache[store] && cache[store][dateKey] !== undefined && cache[store][dateKey] !== null) ? cache[store][dateKey] : null;
}

// 店舗ID⇔店舗名の対応表を作る（複数店舗シフト重複警告で、Supabaseから返るstore_idを
// 店舗名に変換するために使う。全店舗分をキャッシュ済みのgetStoreIdで解決するので通信は最小限）
async function buildStoreIdNameMap() {
  var map = {};
  for (var i = 0; i < STORE_LIST.length; i++) {
    var name = STORE_LIST[i];
    var code = STORE_CODE_MAP[name];
    var id = code ? await TORIYAMA_DB.getStoreId(code) : null;
    if (id) { map[id] = name; }
  }
  return map;
}

/*
  複数店舗シフト重複警告（2026/08/03〜）:
  指定した従業員名たちについて、全店舗分の確定シフトを店舗を絞らずに取得する。
  通常のsyncConfirmedShiftsFromSupabase（今見ている店舗の分だけをローカルキャッシュに反映）
  とは別物で、ローカルキャッシュには書き込まず、その場の警告表示にのみ使う。
  戻り値: { 氏名: { "YYYY-MM-DD": [{ storeId, storeName, start, end }, ...] } }（休みの日は含めない）
*/
async function fetchCrossStoreConfirmedShifts(names, year, monthIdx) {
  if (typeof TORIYAMA_DB === "undefined" || !TORIYAMA_DB.isConfigured()) { return null; }
  var idToName = {};
  names.forEach(function (n) {
    var id = findEmployeeIdByName(n);
    if (id) { idToName[id] = n; }
  });
  var employeeIds = Object.keys(idToName);
  if (!employeeIds.length) { return {}; }

  var storeIdToName = await buildStoreIdNameMap();
  var rows = await TORIYAMA_DB.fetchConfirmedShifts(employeeIds, year, monthIdx + 1);
  var result = {};
  rows.forEach(function (r) {
    if (r.is_off) { return; }
    var name = idToName[r.employee_id];
    if (!name) { return; }
    if (!result[name]) { result[name] = {}; }
    if (!result[name][r.work_date]) { result[name][r.work_date] = []; }
    result[name][r.work_date].push({
      storeId: r.store_id,
      storeName: storeIdToName[r.store_id] || "他店舗",
      start: hmsToLabel(r.start_time),
      end: hmsToLabel(r.end_time)
    });
  });
  return result;
}

// 2つの時間帯（"17:00"形式）が重なっているかどうか
function timeRangesOverlap(startA, endA, startB, endB) {
  var a1 = labelToHour(startA), a2 = labelToHour(endA);
  var b1 = labelToHour(startB), b2 = labelToHour(endB);
  if (a1 === null || a2 === null || b1 === null || b2 === null) { return false; }
  return a1 < b2 && b1 < a2;
}
