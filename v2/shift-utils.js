/*
  TORIYAMA-iS シフト機能で共通利用する日付・時刻ユーティリティ。
  admin-shift.html（管理者：月表示ガント）と shift-confirm.html（スタッフ：確定確認）で共有する。
*/
var SHIFT_DAYS = ["月", "火", "水", "木", "金", "土", "日"];

// 店舗ごとのスタッフ一覧（社員を配列の先頭に置くことで、一覧・ガントとも社員が上に並ぶ）
var STORE_STAFF = {
  "新安城店": ["田中", "山田", "高橋", "中島"],
  "本店": ["佐藤", "鈴木", "岡本", "松本"],
  "駅前店": ["伊藤", "木村", "斎藤", "渡部"],
  "南店": ["加藤", "渡辺", "石井"],
  "西店": ["中村", "小林", "森田"]
};

var SHAIN_NAMES = ["田中", "佐藤", "鈴木", "伊藤", "加藤", "中村"];

function isShain(name) {
  return SHAIN_NAMES.indexOf(name) !== -1;
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
