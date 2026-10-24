
import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

import {
  collection,
  addDoc,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const $ = id => document.getElementById(id);

let currentUser = null;
let records = [];
let filter = "all";
let tickTimer = null;
let loading = false;
let authLoading = false;

const pad = n => String(n).padStart(2, "0");
const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;

function localInputValue(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseDate(s) {
  if (!s) return null;

  const value = String(s).trim();
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/
  );

  if (!match) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const hour = Number(match[4] || 12);
  const minute = Number(match[5] || 0);
  const second = Number(match[6] || 0);
  const ms = Number((match[7] || "0").padEnd(3, "0"));

  const d = new Date(year, month, day, hour, minute, second, ms);

  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month ||
    d.getDate() !== day ||
    d.getHours() !== hour ||
    d.getMinutes() !== minute
  ) {
    return null;
  }

  return d;
}

// يحافظ على يوم الشهر الأصلي قدر الإمكان.
function addMonths(d, n, anchor) {
  const idx = d.getMonth() + n;
  const year = d.getFullYear() + Math.floor(idx / 12);
  const month = ((idx % 12) + 12) % 12;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const day = Math.min(Number(anchor) || d.getDate(), lastDay);

  return new Date(
    year,
    month,
    day,
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
    d.getMilliseconds()
  );
}

function getAnchorDay(r, d) {
  const saved = Number(r.anchorDay);
  return saved >= 1 && saved <= 31 ? saved : d.getDate();
}

function dueDate(r) {
  if (r.manualStatus) return null;

  const d = parseDate(r.lastDate || r.cycleStart);
  if (!d) return null;

  if (r.kind === "discount") {
    d.setDate(d.getDate() + 34);
    return d;
  }

  return addMonths(d, 1, getAnchorDay(r, d));
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);
}

function dateLabel(s) {
  const d = s instanceof Date ? s : parseDate(s);

  return d
    ? new Intl.DateTimeFormat("ar-EG", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
      }).format(d)
    : "—";
}

function countdown(r) {
  if (r.manualStatus) {
    return { text: esc(r.manualStatus), cls: "manual" };
  }

  const d = dueDate(r);
  if (!d) return { text: "موعد غير محدد", cls: "manual" };

  let delta = +d - Date.now();
  const overdue = delta < 0;
  delta = Math.abs(delta);

  const sec = Math.floor(delta / 1000);
  const days = Math.floor(sec / 86400);
  const hours = Math.floor(sec % 86400 / 3600);
  const mins = Math.floor(sec % 3600 / 60);
  const secs = sec % 60;

  const part = (n, label) => `
    <span class="time-part">
      <b>${n}</b>
      <small>${label}</small>
    </span>`;

  return {
    text: `
      ${overdue ? '<span class="overdue-label">متأخر</span>' : ""}
      <span class="countdown-parts">
        ${part(days, "يوم")}
        ${part(pad(hours), "ساعة")}
        ${part(pad(mins), "دقيقة")}
        ${part(pad(secs), "ثانية")}
      </span>`,
    cls: overdue ? "late" : (+d - Date.now() <= THREE_DAYS ? "due" : "")
  };
}

function message(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function friendly(e) {
  const code = e?.code || "";

  const errors = {
    "auth/invalid-credential": "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
    "auth/user-not-found": "الحساب غير موجود. تأكد من البريد أو أنشئ حسابًا.",
    "auth/wrong-password": "كلمة المرور غير صحيحة.",
    "auth/email-already-in-use": "البريد الإلكتروني مستخدم بالفعل.",
    "auth/weak-password": "كلمة المرور لازم تكون 6 أحرف على الأقل.",
    "auth/invalid-email": "راجع صيغة البريد الإلكتروني.",
    "auth/too-many-requests": "محاولات كثيرة. استنى شوية وجرب تاني.",
    "auth/network-request-failed": "في مشكلة اتصال بالإنترنت.",
    "auth/operation-not-allowed": "طريقة تسجيل الدخول غير مفعّلة في Firebase.",
    "permission-denied": "الصلاحيات مرفوضة. راجع قواعد Firestore.",
    "unavailable": "الخدمة غير متاحة مؤقتًا. حاول مرة أخرى."
  };

  return errors[code] || e?.message || "حصل خطأ غير متوقع.";
}

async function load() {
  if (!currentUser) return;

  const snap = await getDocs(
    query(
      collection(db, "users", currentUser.uid, "numbers"),
      orderBy("createdAt", "desc")
    )
  );

  records = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  render();
}

function render() {
  const now = Date.now();
  const eligible = records.filter(r => !r.manualStatus && dueDate(r));
  const groups = new Map();

  for (const r of records) {
    const phone = String(r.phone || "").replace(/\s/g, "");
    if (!groups.has(phone)) groups.set(phone, []);
    groups.get(phone).push(r);
  }

  $("totalCount").textContent = groups.size;

  $("todayCount").textContent = eligible.filter(r =>
    dueDate(r)?.toDateString() === new Date().toDateString()
  ).length;

  $("lateCount").textContent = eligible.filter(r =>
    +dueDate(r) < now
  ).length;

  const soonPhones = new Set(
    eligible.filter(r => {
      const delta = +dueDate(r) - now;
      return delta >= 0 && delta <= THREE_DAYS;
    }).map(r => String(r.phone || "").replace(/\s/g, ""))
  );

  $("soonCount").textContent = soonPhones.size;

  const searchText = $("search").value.trim().toLowerCase();

  const visible = [...groups.entries()].filter(([phone, items]) => {
    const first = items[0];

    const matchesSearch =
      `${first.name || ""} ${phone}`.toLowerCase().includes(searchText);

    const matchesFilter = filter === "all" || items.some(r => {
      const d = dueDate(r);

      if (filter === "due") return d && +d <= now;

      if (filter === "soon") {
        if (!d) return false;
        const delta = +d - now;
        return delta >= 0 && delta <= THREE_DAYS;
      }

      return r.kind === filter;
    });

    return matchesSearch && matchesFilter;
  });

  $("shownCount").textContent = `${visible.length} رقم`;
  $("empty").classList.toggle("hidden", visible.length > 0);

  function followupCard(r, kind) {
    const title = kind === "mini" ? "الميني باك" : "الخصم";

    if (!r) {
      return `
        <div class="followup-row missing">
          <strong>${title}</strong>
          <p>المتابعة دي مش موجودة في السجلات.</p>
        </div>`;
    }

    const c = countdown(r);

    return `
      <div class="followup-row">
        <div class="followup-date">
          <span>الموعد القادم</span>
          <strong>${r.manualStatus ? esc(r.manualStatus) : dateLabel(dueDate(r))}</strong>
        </div>
        <div class="countdown ${c.cls}" data-countdown="${esc(r.id)}">
          ${c.text}
        </div>
        <div class="followup-actions">
          <button class="btn secondary" data-action="done" data-id="${esc(r.id)}" type="button">تمت العملية</button>
          <button class="btn secondary" data-action="edit" data-id="${esc(r.id)}" type="button">تعديل</button>
          <button class="btn danger" data-action="delete" data-id="${esc(r.id)}" type="button">حذف</button>
        </div>
      </div>`;
  }

  $("records").innerHTML = visible.map(([phone, items]) => {
    const mini = items.find(r => r.kind === "mini");
    const discount = items.find(r => r.kind === "discount");
    const first = items[0];

    return `
      <article class="record grouped-record">
        <div class="record-head">
          <div class="record-identity">
            <div class="record-name">${esc(first.name || "بدون اسم")}</div>
            <div class="phone" dir="ltr">${esc(phone)}</div>
          </div>
        </div>
        <div class="followups">
          <section class="followup-section mini-section">
            <h3>الميني باك</h3>
            ${followupCard(mini, "mini")}
          </section>
          <section class="followup-section discount-section">
            <h3>الخصم</h3>
            ${followupCard(discount, "discount")}
          </section>
        </div>
      </article>`;
  }).join("");
}

function resetForm() {
  $("numberForm").reset();
  $("editId").value = "";
  $("lastDate").value = localInputValue();
  $("formTitle").textContent = "إضافة سجل جديد";
  $("cancelEdit").classList.add("hidden");
  message("formMsg", "");
}

// إضافة سجل أو تعديل سجل موجود.
$("numberForm").addEventListener("submit", async e => {
  e.preventDefault();

  if (!currentUser || loading) return;

  const submitBtn = $("numberForm").querySelector('button[type="submit"]');
  const id = $("editId").value;
  const phone = $("phone").value.trim().replace(/\s+/g, "");
  const name = $("personName").value.trim();
  const kind = $("kind").value;
  const lastDate = $("lastDate").value;
  const manualStatus = $("manualStatus").value;
  const parsed = parseDate(lastDate);

  if (!phone || !parsed) {
    message("formMsg", "اكتب رقم الهاتف وحدد تاريخ آخر عملية صحيحًا.");
    return;
  }

  const existing = id ? records.find(r => r.id === id) : null;

  const anchorDay = kind === "mini"
    ? (existing?.kind === "mini"
        ? getAnchorDay(existing, parsed)
        : parsed.getDate())
    : parsed.getDate();

  const data = {
    phone,
    name,
    kind,
    lastDate,
    cycleStart: lastDate,
    manualStatus: manualStatus || "",
    anchorDay,
    updatedAt: serverTimestamp()
  };

  loading = true;
  if (submitBtn) submitBtn.disabled = true;

  try {
    if (id) {
      await updateDoc(
        doc(db, "users", currentUser.uid, "numbers", id),
        data
      );
    } else {
      const exists = records.some(r =>
        String(r.phone || "").replace(/\s/g, "") === phone &&
        r.kind === kind
      );

      if (exists) {
        message("formMsg", "السجل ده موجود بالفعل لنفس الرقم ونوع المتابعة.");
        return;
      }

      await addDoc(
        collection(db, "users", currentUser.uid, "numbers"),
        { ...data, createdAt: serverTimestamp() }
      );
    }

    message("formMsg", "تم الحفظ بنجاح.");
    resetForm();
    await load();
  } catch (e) {
    message("formMsg", friendly(e));
  } finally {
    loading = false;
    if (submitBtn) submitBtn.disabled = false;
  }
});

$("cancelEdit").addEventListener("click", resetForm);

// أزرار التعديل وتسجيل العملية والحذف.
$("records").addEventListener("click", async e => {
  const b = e.target.closest("button[data-action]");
  if (!b || !currentUser || b.disabled) return;

  const r = records.find(x => x.id === b.dataset.id);
  if (!r) return;

  if (b.dataset.action === "edit") {
    $("editId").value = r.id;
    $("personName").value = r.name || "";
    $("phone").value = r.phone || "";
    $("kind").value = r.kind || "discount";
    $("lastDate").value = (r.lastDate || r.cycleStart || "").slice(0, 16);
    $("manualStatus").value = r.manualStatus || "";
    $("formTitle").textContent = "تعديل السجل";
    $("cancelEdit").classList.remove("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }

  if (b.dataset.action === "done") {
    if (!confirm("تأكيد تسجيل العملية الآن؟")) return;

    const nowDate = new Date();
    const now = localInputValue(nowDate);
    const previousDate = parseDate(r.lastDate || r.cycleStart) || nowDate;

    const anchorDay = r.kind === "mini"
      ? getAnchorDay(r, previousDate)
      : nowDate.getDate();

    b.disabled = true;

    try {
      await updateDoc(
        doc(db, "users", currentUser.uid, "numbers", r.id),
        {
          lastDate: now,
          cycleStart: now,
          anchorDay,
          manualStatus: "",
          updatedAt: serverTimestamp()
        }
      );

      await load();
    } catch (e) {
      alert(friendly(e));
    } finally {
      b.disabled = false;
    }
  }

  if (b.dataset.action === "delete") {
    if (!confirm(
      `حذف متابعة ${r.kind === "discount" ? "الخصم" : "الميني باك"} للرقم ${r.phone} نهائيًا؟`
    )) return;

    b.disabled = true;

    try {
      await deleteDoc(
        doc(db, "users", currentUser.uid, "numbers", r.id)
      );
      await load();
    } catch (e) {
      alert(friendly(e));
    } finally {
      b.disabled = false;
    }
  }
});

// البحث والفلاتر.
$("search").addEventListener("input", render);

document.querySelectorAll(".filter").forEach(b => {
  b.addEventListener("click", () => {
    filter = b.dataset.filter;

    document.querySelectorAll(".filter").forEach(x => {
      x.classList.toggle("active", x === b);
    });

    render();
  });
});

function showSoonRecords() {
  filter = "soon";

  document.querySelectorAll(".filter").forEach(button => {
    button.classList.toggle("active", button.dataset.filter === "soon");
  });

  render();

  $("records").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

if ($("soonStat")) {
  $("soonStat").addEventListener("click", showSoonRecords);

  $("soonStat").addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      showSoonRecords();
    }
  });
}

// تصدير نسخة CSV احتياطية.
$("exportBtn").addEventListener("click", () => {
  const cols = [
    "id", "name", "phone", "kind", "lastDate",
    "cycleStart", "manualStatus", "anchorDay", "createdAt", "updatedAt"
  ];

  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;

  const csv = "\uFEFF" + [
    cols.join(","),
    ...records.map(r => cols.map(k => {
      const v = k === "createdAt" || k === "updatedAt"
        ? (r[k]?.toDate?.()?.toISOString?.() || r[k] || "")
        : r[k];

      return q(v);
    }).join(","))
  ].join("\r\n");

  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" })
  );

  const a = document.createElement("a");
  a.href = url;
  a.download = `shokr-tracker-backup-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
  message("importMsg", `تم تجهيز نسخة احتياطية تضم ${records.length} سجلًا.`);
});

// فحص السجلات المكررة دون حذف أي بيانات.
$("auditBtn").addEventListener("click", () => {
  const groups = new Map();

  for (const r of records) {
    const key = `${String(r.phone || "").replace(/\s/g, "")}|${r.kind || "unknown"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const dup = [...groups.entries()].filter(([, a]) => a.length > 1);
  const box = $("auditBox");

  box.classList.remove("hidden");

  box.innerHTML = dup.length
    ? `<strong>تم العثور على ${dup.length} مجموعة مكررة.</strong>
       <p>لم يتم حذف أو تعديل أي بيانات.</p>
       <ul>${dup.slice(0, 30).map(([k, a]) =>
         `<li>${esc(k)}: ${a.length} سجلات</li>`
       ).join("")}</ul>`
    : `<strong>لم يظهر أي تكرار حسب رقم الهاتف ونوع المتابعة.</strong>
       <p>لم يتم تعديل أي بيانات.</p>`;
});

$("importBtn").addEventListener("click", () => {
  alert("قائمة الأرقام الأصلية غير موجودة في هذا الملف. لم تتم إضافة أو حذف أي سجل.");
});

// التحقق من بيانات الحساب.
function validateCredentials() {
  const emailInput = $("email");
  const passwordInput = $("password");
  const email = emailInput.value.trim();

  if (!email || !emailInput.checkValidity()) {
    message("authMsg", "اكتب بريدًا إلكترونيًا صحيحًا.");
    emailInput.focus();
    return null;
  }

  if (!passwordInput.value || passwordInput.value.length < 6) {
    message("authMsg", "كلمة المرور لازم تكون 6 أحرف على الأقل.");
    passwordInput.focus();
    return null;
  }

  return { email, password: passwordInput.value };
}

// تسجيل الدخول: معالج submit واحد فقط، دون استدعاء click مرة أخرى.
$("authForm").addEventListener("submit", async e => {
  e.preventDefault();

  if (authLoading) return;

  const credentials = validateCredentials();
  if (!credentials) return;

  const button = $("loginBtn");
  authLoading = true;
  button.disabled = true;
  message("authMsg", "جارٍ تسجيل الدخول...");

  try {
    await signInWithEmailAndPassword(
      auth,
      credentials.email,
      credentials.password
    );

    message("authMsg", "");
  } catch (e) {
    message("authMsg", friendly(e));
  } finally {
    authLoading = false;
    button.disabled = false;
  }
});

// إنشاء حساب جديد.
$("signupBtn").addEventListener("click", async () => {
  if (authLoading) return;

  const credentials = validateCredentials();
  if (!credentials) return;

  const button = $("signupBtn");
  authLoading = true;
  button.disabled = true;
  message("authMsg", "جارٍ إنشاء الحساب...");

  try {
    await createUserWithEmailAndPassword(
      auth,
      credentials.email,
      credentials.password
    );

    message("authMsg", "تم إنشاء الحساب بنجاح.");
  } catch (e) {
    message("authMsg", friendly(e));
  } finally {
    authLoading = false;
    button.disabled = false;
  }
});

// استعادة كلمة المرور.
if ($("forgotPasswordBtn")) {
  $("forgotPasswordBtn").addEventListener("click", async () => {
    const emailInput = $("email");
    const email = emailInput.value.trim();

    if (!email || !emailInput.checkValidity()) {
      message("authMsg", "اكتب بريدك الإلكتروني الصحيح أولًا.");
      emailInput.focus();
      return;
    }

    const button = $("forgotPasswordBtn");
    button.disabled = true;
    message("authMsg", "جارٍ إرسال رسالة استعادة كلمة المرور...");

    try {
      await sendPasswordResetEmail(auth, email);

      message(
        "authMsg",
        "لو البريد مسجل، هتوصلك رسالة استعادة كلمة المرور. راجع الوارد والرسائل غير المرغوب فيها."
      );
    } catch (e) {
      message("authMsg", friendly(e));
    } finally {
      button.disabled = false;
    }
  });
}

// تسجيل الخروج.
$("logoutBtn").addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (e) {
    message("formMsg", friendly(e));
  }
});

// متابعة حالة تسجيل الدخول.
onAuthStateChanged(auth, async user => {
  currentUser = user;

  $("authView").classList.toggle("hidden", !!user);
  $("appView").classList.toggle("hidden", !user);

  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }

  if (user) {
    $("userBadge").textContent = user.email || "متصل";
    resetForm();

    try {
      await load();

      tickTimer = setInterval(() => {
        render();
      }, 1000);
    } catch (e) {
      message("formMsg", friendly(e));
    }
  } else {
    records = [];
    $("records").innerHTML = "";
  }
});
