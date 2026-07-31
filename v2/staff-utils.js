/*
  TORIYAMA-iS スタッフ台帳（写真・所属店舗・生年月日・入社日・性別・雇用形態）。

  2026/07/31〜: Supabase設定済みの場合は、Supabaseのemployeesテーブルを正とし、
  localStorage（toriyama_staff_roster）はその「オフラインキャッシュ／表示用ミラー」
  として扱う。Supabase未設定時は従来通りlocalStorageのみで完結する（demo動作）。

  読み込み順について: このファイルは必ず supabase-client.js と shift-utils.js
  （STORE_LIST / STORE_CODE_MAP を使うため）より後に読み込むこと。

  画面側は、ページ読み込み時にまず await syncStaffRosterFromSupabase() を呼び、
  その後で getStaffRoster() / getStoreStaffNames() 等の同期関数を使う想定。
  スタッフの登録・解除は registerStaffMember() / unregisterStaffMember() を使う
  （Supabase設定済みならSupabaseに書き込んでからローカルキャッシュを更新、
  未設定ならローカルのみ更新する）。

  ★写真について: 今はSupabase側もdata URL文字列をそのままphoto_url列に格納する
  簡易実装。件数・画質が増えるとテーブルが肥大化するため、本格運用ではSupabase
  Storageへの保存＋URL参照に切り替えることを検討。
*/
var staffRosterKey = "toriyama_staff_roster";

function getStaffRoster() {
  try { return JSON.parse(localStorage.getItem(staffRosterKey) || "[]"); }
  catch (e) { return []; }
}

function saveStaffRoster(list) {
  localStorage.setItem(staffRosterKey, JSON.stringify(list));
}

// ローカルのみに追加（Supabase未設定時のフォールバック）
function addStaffMember(person) {
  var list = getStaffRoster();
  person.id = "staff_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
  list.push(person);
  saveStaffRoster(list);
  return person;
}

// ローカルのみから削除（Supabase未設定時のフォールバック）
function removeStaffMember(id) {
  var list = getStaffRoster().filter(function (p) { return p.id !== id; });
  saveStaffRoster(list);
}

// Supabaseのemployees/storesを取得し、ローカルキャッシュ（toriyama_staff_roster）を
// 最新の状態に上書きする。Supabase未設定・通信失敗時は何もせず false を返す
// （その場合、既存のローカルキャッシュがそのまま使われる＝オフライン継続動作）。
async function syncStaffRosterFromSupabase() {
  if (typeof TORIYAMA_DB === "undefined" || !TORIYAMA_DB.isConfigured()) { return false; }
  try {
    var stores = await TORIYAMA_DB.fetchAllStores();
    var storeIdToName = {};
    stores.forEach(function (s) { storeIdToName[s.id] = s.name; });

    var employees = await TORIYAMA_DB.fetchAllEmployees();
    var roster = employees.map(function (e) {
      return {
        id: e.id,
        name: e.name,
        store: storeIdToName[e.home_store_id] || "",
        employmentType: e.role,
        birthDate: e.birth_date || "",
        hireDate: e.hire_date || "",
        gender: e.gender || "",
        photo: e.photo_url || ""
      };
    });
    saveStaffRoster(roster);
    return true;
  } catch (e) {
    return false;
  }
}

// スタッフを登録する（Supabase設定済みならSupabaseへ、未設定ならローカルのみへ）
async function registerStaffMember(person) {
  if (typeof TORIYAMA_DB !== "undefined" && TORIYAMA_DB.isConfigured()) {
    var storeCode = (typeof STORE_CODE_MAP !== "undefined") ? STORE_CODE_MAP[person.store] : null;
    var storeId = storeCode ? await TORIYAMA_DB.getStoreId(storeCode) : null;
    var res = await TORIYAMA_DB.addEmployee({
      name: person.name,
      employmentType: person.employmentType,
      storeId: storeId,
      birthDate: person.birthDate,
      hireDate: person.hireDate,
      gender: person.gender,
      photo: person.photo
    });
    if (res.error) { return { error: res.error }; }
    await syncStaffRosterFromSupabase();
    return { ok: true };
  }
  addStaffMember(person);
  return { ok: true };
}

// スタッフを解除する（Supabase設定済みならactive=falseに、未設定ならローカルから削除）
async function unregisterStaffMember(id) {
  if (typeof TORIYAMA_DB !== "undefined" && TORIYAMA_DB.isConfigured()) {
    var res = await TORIYAMA_DB.deactivateEmployee(id);
    if (res.error) { return { error: res.error }; }
    await syncStaffRosterFromSupabase();
    return { ok: true };
  }
  removeStaffMember(id);
  return { ok: true };
}
