/*
  TORIYAMA-iS 掲示板（お知らせ）のSupabase連携。2026/07/31〜: 実データ化。

  以前はadmin-board.html/renraku-board.htmlにハードコードされた仮の投稿データのみで、
  投稿・既読はページを再読み込みすると消えていた（保存自体されていなかった）。
  ここでは実際にSupabaseのboard_posts/board_readsに保存・取得する。

  読み込み順について: このファイルは必ず supabase-client.js / shift-utils.js /
  staff-utils.js より後に読み込むこと（STORE_CODE_MAPとfindEmployeeIdByNameを使うため）。

  この掲示板にはログイン機能が無いため、「誰が既読にしたか」は各画面で選択した
  氏名（STAFF登録データに登録済みの人のみ）を使って記録する。
*/

// 会社全体の投稿一覧を、既読情報とあわせて取得する。
// 戻り値: [{ id, store, body, image, postedAt, postedByName, readBy: [employeeId, ...] }, ...]
// Supabase未設定時はnullを返す（呼び出し側は「投稿機能は使えません」等の案内を出す）
async function fetchBoardPosts() {
  if (typeof TORIYAMA_DB === "undefined" || !TORIYAMA_DB.isConfigured()) { return null; }
  try {
    var stores = await TORIYAMA_DB.fetchAllStores();
    var storeIdToName = {};
    stores.forEach(function (s) { storeIdToName[s.id] = s.name; });

    var roster = (typeof getStaffRoster === "function") ? getStaffRoster() : [];
    var employeeIdToName = {};
    roster.forEach(function (p) { employeeIdToName[p.id] = p.name; });

    var posts = await TORIYAMA_DB.fetchAllBoardPosts();
    var postIds = posts.map(function (p) { return p.id; });
    var reads = postIds.length ? await TORIYAMA_DB.fetchBoardReadsForPosts(postIds) : [];
    var readsByPost = {};
    reads.forEach(function (r) {
      if (!readsByPost[r.post_id]) { readsByPost[r.post_id] = []; }
      readsByPost[r.post_id].push(r.employee_id);
    });

    return posts.map(function (p) {
      return {
        id: p.id,
        store: storeIdToName[p.store_id] || "",
        body: p.body,
        image: p.image_url,
        postedAt: p.posted_at,
        postedByName: employeeIdToName[p.posted_by] || "",
        readBy: readsByPost[p.id] || []
      };
    });
  } catch (e) {
    return null;
  }
}

// 掲示板の画像添付は、スマホのカメラ写真をそのままdata URLで保存すると
// 数MB〜10MB超になり、Supabaseへの保存やlocalStorageキャッシュの容量超過の
// 原因になる（STAFF登録の写真で実際に起きた不具合と同じ）。ここで長辺1000px以内・
// JPEG品質0.75に自動縮小してから使う。
function resizeImageDataUrl(dataUrl, maxSize, quality) {
  return new Promise(function (resolve) {
    var img = new Image();
    img.onload = function () {
      var w = img.width, h = img.height;
      if (w > maxSize || h > maxSize) {
        if (w >= h) { h = Math.round(h * (maxSize / w)); w = maxSize; }
        else { w = Math.round(w * (maxSize / h)); h = maxSize; }
      }
      var canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = function () { resolve(dataUrl); };
    img.src = dataUrl;
  });
}

// 新規投稿（imageDataUrlはFileReaderで読み込んだdata URL文字列、無ければnull可。
// postedByは投稿者のemployee id、無ければnull可＝管理者投稿など個人が紐付かない場合）
async function postBoardMessage(store, body, imageDataUrl, postedBy) {
  if (typeof TORIYAMA_DB === "undefined" || !TORIYAMA_DB.isConfigured()) { return { error: "not_configured" }; }
  var storeCode = (typeof STORE_CODE_MAP !== "undefined") ? STORE_CODE_MAP[store] : null;
  var storeId = storeCode ? await TORIYAMA_DB.getStoreId(storeCode) : null;
  if (!storeId) { return { error: "store_not_found" }; }
  return await TORIYAMA_DB.insertBoardPost({ storeId: storeId, body: body, imageUrl: imageDataUrl || null, postedBy: postedBy || null });
}

// 指定した氏名（STAFF登録済みの人）としてこの投稿を既読にする
async function markBoardRead(postId, employeeName) {
  if (typeof TORIYAMA_DB === "undefined" || !TORIYAMA_DB.isConfigured()) { return false; }
  var employeeId = (typeof findEmployeeIdByName === "function") ? findEmployeeIdByName(employeeName) : null;
  if (!employeeId) { return false; }
  var res = await TORIYAMA_DB.markBoardPostRead(postId, employeeId);
  return !res.error;
}

// 投稿時刻の表示用フォーマット（今日ならHH:MM、昨日なら「昨日」、それ以外はM/D）
function formatBoardTime(iso) {
  if (!iso) { return ""; }
  var d = new Date(iso);
  var now = new Date();
  function ymd(x) { return x.getFullYear() + "-" + x.getMonth() + "-" + x.getDate(); }
  function pad2(n) { return ("0" + n).slice(-2); }
  if (ymd(d) === ymd(now)) { return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }
  var y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (ymd(d) === ymd(y)) { return "昨日"; }
  return (d.getMonth() + 1) + "/" + d.getDate();
}
