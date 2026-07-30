/*
  TORIYAMA-iS スタッフ台帳（写真・所属店舗・生年月日・入社日・性別）の
  localStorage共有ユーティリティ。admin-staff.html（登録・解除）と
  staff-directory.html（STAFF一覧）の両方で使う。

  将来的にSupabaseのemployeesテーブルへ移行する場合は、この台帳の項目
  （photo/store/birthDate/hireDate/gender）をどう持たせるか要検討
  （現状のschema.sqlのemployeesにはこれらの列が無い）。
*/
var staffRosterKey = "toriyama_staff_roster";

function getStaffRoster() {
  try { return JSON.parse(localStorage.getItem(staffRosterKey) || "[]"); }
  catch (e) { return []; }
}

function saveStaffRoster(list) {
  localStorage.setItem(staffRosterKey, JSON.stringify(list));
}

function addStaffMember(person) {
  var list = getStaffRoster();
  person.id = "staff_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
  list.push(person);
  saveStaffRoster(list);
  return person;
}

function removeStaffMember(id) {
  var list = getStaffRoster().filter(function (p) { return p.id !== id; });
  saveStaffRoster(list);
}
