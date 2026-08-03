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

// 生年月日（"YYYY-MM-DD"）を「M月D日」形式に変換する（年は表示しない）
function birthdayLabel(dateStr) {
  if (!dateStr) { return ""; }
  var parts = dateStr.split("-");
  if (parts.length !== 3) { return ""; }
  return Number(parts[1]) + "月" + Number(parts[2]) + "日";
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
    var access = await TORIYAMA_DB.fetchAllEmployeeStoreAccess();
    var employees = await TORIYAMA_DB.fetchAllEmployees();
    // いずれかがnull＝通信失敗／未接続。「0件取得できた」と区別し、
    // 既存のローカルキャッシュを空で上書きしてしまわないようにする
    // （2026/08/03〜: 通信が一時的に不安定な端末で登録スタッフが消えて見えるバグの原因だった）。
    if (stores === null || access === null || employees === null) { return false; }

    var storeIdToName = {};
    stores.forEach(function (s) { storeIdToName[s.id] = s.name; });

    // 従業員ごとの勤務可能店舗（掛け持ち対応。2026/08/03〜）
    var storesByEmployee = {};
    access.forEach(function (a) {
      var name = storeIdToName[a.store_id];
      if (!name) { return; }
      if (!storesByEmployee[a.employee_id]) { storesByEmployee[a.employee_id] = []; }
      if (storesByEmployee[a.employee_id].indexOf(name) === -1) { storesByEmployee[a.employee_id].push(name); }
    });

    var roster = employees.map(function (e) {
      var homeStoreName = storeIdToName[e.home_store_id] || "";
      // employee_store_accessに未登録（移行前データ等）の場合はhome_store_idを唯一の勤務店舗として扱う
      var storeNames = storesByEmployee[e.id] || (homeStoreName ? [homeStoreName] : []);
      return {
        id: e.id,
        name: e.name,
        store: homeStoreName,      // 主な所属店舗（表示・後方互換用）
        stores: storeNames,        // 勤務可能な全店舗（掛け持ち対応。フィルタはこちらを使う）
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
// person.stores: 勤務可能な店舗名の配列（掛け持ち対応。1件目を「主な所属店舗」として扱う）
async function registerStaffMember(person) {
  var storeList = person.stores || (person.store ? [person.store] : []);
  if (typeof TORIYAMA_DB !== "undefined" && TORIYAMA_DB.isConfigured()) {
    var storeIds = [];
    for (var i = 0; i < storeList.length; i++) {
      var code = (typeof STORE_CODE_MAP !== "undefined") ? STORE_CODE_MAP[storeList[i]] : null;
      var id = code ? await TORIYAMA_DB.getStoreId(code) : null;
      if (id) { storeIds.push(id); }
    }
    var res = await TORIYAMA_DB.addEmployee({
      name: person.name,
      employmentType: person.employmentType,
      storeId: storeIds[0] || null,
      birthDate: person.birthDate,
      hireDate: person.hireDate,
      gender: person.gender,
      photo: person.photo
    });
    if (res.error) { return { error: res.error }; }
    var newId = res.data && res.data[0] && res.data[0].id;
    if (newId && storeIds.length) { await TORIYAMA_DB.setEmployeeStoreAccess(newId, storeIds); }
    await syncStaffRosterFromSupabase();
    return { ok: true };
  }
  person.store = storeList[0] || "";
  person.stores = storeList;
  addStaffMember(person);
  return { ok: true };
}

// 既存スタッフの勤務可能店舗を更新する（掛け持ち先の追加・変更用）
async function updateStaffStores(id, storeNames) {
  if (typeof TORIYAMA_DB !== "undefined" && TORIYAMA_DB.isConfigured()) {
    var storeIds = [];
    for (var i = 0; i < storeNames.length; i++) {
      var code = (typeof STORE_CODE_MAP !== "undefined") ? STORE_CODE_MAP[storeNames[i]] : null;
      var sid = code ? await TORIYAMA_DB.getStoreId(code) : null;
      if (sid) { storeIds.push(sid); }
    }
    var res = await TORIYAMA_DB.setEmployeeStoreAccess(id, storeIds);
    if (res.error) { return { error: res.error }; }
    return { ok: true };
  }
  var list = getStaffRoster();
  var person = list.filter(function (p) { return p.id === id; })[0];
  if (person) {
    person.stores = storeNames;
    person.store = storeNames[0] || "";
    saveStaffRoster(list);
  }
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
