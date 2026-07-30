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
var STORE_LIST = [
  "餃子酒場さんちょうめ",
  "鳥料理と炭火焼 鶏やま",
  "Tripot cafe BAKE stand",
  "Tripot cafe FOOD truck ①",
  "Tripot cafe FOOD truck ②"
];

// 店舗名 → Supabase stores.code の対応（打刻端末の店舗設定などで使う）
var STORE_CODE_MAP = {
  "餃子酒場さんちょうめ": "sanchome",
  "鳥料理と炭火焼 鶏やま": "keiyama",
  "Tripot cafe BAKE stand": "tripot-bake",
  "Tripot cafe FOOD truck ①": "tripot-truck1",
  "Tripot cafe FOOD truck ②": "tripot-truck2"
};

// 指定店舗の在籍スタッフ名一覧をSTAFF登録データから取得（社員を配列の先頭に）
function getStoreStaffNames(store) {
  var roster = (typeof getStaffRoster === "function") ? getStaffRoster() : [];
  var inStore = roster.filter(function (p) { return p.store === store; });
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
