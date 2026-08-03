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

// 従業員が指定店舗で勤務できるか（掛け持ち対応。stores配列が無い旧データはstoreを1件のみとして扱う）
function staffWorksAt(person, store) {
  var stores = person.stores || (person.store ? [person.store] : []);
  return stores.indexOf(store) !== -1;
}

// 指定店舗の在籍スタッフ名一覧をSTAFF登録データから取得（社員を配列の先頭に）
function getStoreStaffNames(store) {
  var roster = (typeof getStaffRoster === "function") ? getStaffRoster() : [];
  var inStore = roster.filter(function (p) { return staffWorksAt(p, store); });
  var shain = inStore.filter(function (p) { return p.employmentType === "shain"; }).map(function (p) { return p.name; });
  var baito = inStore.filter(function (p) { return p.employmentType !== "shain"; }).map(function (p) { return p.name; });
  return shain.concat(baito);
}

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
