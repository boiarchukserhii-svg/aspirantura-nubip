import {initializeApp} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {getAuth,GoogleAuthProvider,signInWithPopup,signOut,onAuthStateChanged,setPersistence,browserLocalPersistence}
  from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {getFirestore,collection,doc,onSnapshot,runTransaction}
  from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import {firebaseConfig} from "./sync-config.js?v=34";

if (!firebaseConfig) throw Error("Синхронізацію ще не підключено до Firebase.");
const app = initializeApp(firebaseConfig,"aspirantura-nubip");
const auth = getAuth(app);
const database = getFirestore(app);
const owner = "boiarchuk.serhii@gmail.com";
const encoder = new TextEncoder();
const maxChunk = 160000;
const maxChunks = 32;

const isGoogleUser = user => Boolean(user?.email && user.emailVerified
  && user.providerData.some(provider => provider.providerId === "google.com"));
const isOwner = user => isGoogleUser(user) && user.email === owner;
export const observe = callback => onAuthStateChanged(auth,callback);
export const logout = () => signOut(auth);
export function observeAccess(user,receive,fail) {
  if (!isGoogleUser(user) || isOwner(user)) {
    receive(isOwner(user) ? "owner" : null);
    return () => {};
  }
  return onSnapshot(doc(database,"workspaces","aspirantura-nubip","viewers",user.email),
    {includeMetadataChanges:true},snapshot => {
      if (!snapshot.metadata.fromCache) receive(snapshot.data()?.enabled === true ? "viewer" : null);
    },fail);
}
export async function login() {
  await setPersistence(auth,browserLocalPersistence);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({prompt:"select_account"});
  await signInWithPopup(auth,provider);
}

function ledger() {
  if (!isGoogleUser(auth.currentUser)) throw Error("Увійдіть через підтверджений Google-акаунт.");
  return collection(database,"workspaces","aspirantura-nubip","registry");
}

export function subscribe(receive,fail) {
  const ref = ledger();
  return onSnapshot(ref,{includeMetadataChanges:true},snapshot => {
    if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
    try {
      const docs = new Map(snapshot.docs.map(item => [item.id,item.data()]));
      const meta = docs.get("meta");
      if (!meta) {
        if (docs.size) throw Error("Сховище потребує перевірки.");
        receive({cards:[],revision:0});
        return;
      }
      if (!Number.isSafeInteger(meta.revision) || meta.revision < 1
          || !Number.isInteger(meta.count) || meta.count < 0 || meta.count > maxChunks) {
        throw Error("Сховище потребує перевірки.");
      }
      const cards = [];
      for (let index=0; index<meta.count; index++) {
        const chunk = docs.get("part-"+index);
        if (chunk?.revision !== meta.revision || typeof chunk.data !== "string") throw Error("Реєстр отримано не повністю.");
        const rows = JSON.parse(chunk.data);
        if (!Array.isArray(rows)) throw Error("Некоректні дані реєстру.");
        cards.push(...rows);
      }
      receive({cards,revision:meta.revision});
    } catch (error) { fail(error); }
  },fail);
}

function pack(cards) {
  const chunks = [];
  let rows = [], size = 2;
  for (const card of cards) {
    const row = JSON.stringify(card);
    const length = encoder.encode(row).length;
    if (length + 2 > maxChunk) throw Error("Одна картка перевищує допустимий розмір.");
    if (size + length + (rows.length ? 1 : 0) > maxChunk) {
      chunks.push("["+rows.join(",")+"]");
      rows = [];
      size = 2;
    }
    size += length + (rows.length ? 1 : 0);
    rows.push(row);
  }
  if (rows.length) chunks.push("["+rows.join(",")+"]");
  if (chunks.length > maxChunks) throw Error("Реєстр перевищує допустимий розмір синхронізації.");
  return chunks;
}

export async function save(cards,revision) {
  if (!isOwner(auth.currentUser)) throw Error("Змінювати спільний реєстр може лише власник.");
  const ref = ledger(), metaRef = doc(ref,"meta"), chunks = pack(cards);
  const next = revision+1;
  await runTransaction(database,async transaction => {
    const previous = await transaction.get(metaRef);
    const data = previous.data();
    if ((data?.revision ?? 0) !== revision) {
      throw Error("На іншому пристрої вже є зміни. Дочекайтеся оновлення і відкрийте картку знову.");
    }
    chunks.forEach((content,index) => transaction.set(doc(ref,"part-"+index),{data:content,revision:next}));
    for (let index=chunks.length; index<(data?.count ?? 0); index++) transaction.delete(doc(ref,"part-"+index));
    transaction.set(metaRef,{revision:next,count:chunks.length});
  });
  return next;
}

export function errorText(error) {
  if (["permission-denied","not-found","failed-precondition"].includes(error?.code)) {
    return "Спільне сховище ще недоступне. Перевірте налаштування Firestore і правила доступу.";
  }
  if (error?.code === "auth/popup-blocked") return "Браузер заблокував вхід. Відкрийте сайт у Safari, Chrome або Edge та дозвольте вікно входу.";
  if (error?.code === "auth/popup-closed-by-user") return "Вхід скасовано.";
  if (error?.code === "auth/unauthorized-domain") return "Адресу GitHub Pages потрібно дозволити у Firebase Authentication.";
  if (["unavailable","auth/network-request-failed"].includes(error?.code)) return "Немає зв’язку зі сховищем. Спробуйте після підключення.";
  return error?.message || "Не вдалося синхронізувати реєстр.";
}
