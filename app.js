
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

const pad = n => String(n).padStart(2, "0");

function localInputValue(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseDate(s) {
  if (!s) return null;
  const d = new Date(s.length === 10 ? `${s}T12:00` : s);
  return Number.isNaN(+d) ? null : d;
}

function addMonths(d, n, anchor) {
  const idx = d.getMonth() + n;
  const y = d.getFullYear() + Math.floor(idx / 12);
  const m = ((idx % 12) + 12) % 12;

  return new Date(
    y,
    m,
    Math.min(anchor || d.getDate(), new Date(y, m + 1, 0).getDate()),
    d.getHours(),
    d.getMinutes(),
    d.getSeconds()
  );
}

function dueDate(r) {
  if (r.manualStatus) return null;

  const d = parseDate(r.cycleStart || r.lastDate);
  if (!d) return null;

  if (r.kind === "discount") {
    d.setDate(d.getDate() + 34);
    return d;
  }

  return addMonths(d, 1, r.anchorDay || d.getDate());
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
        minute: "2-digit"
      }).format(d)
    : "—";
}

function countdown(r) {
  if (r.manualStatus) {
    return { text: esc(r.manualStatus), cls: "manual" };
  }

  const d = dueDate(r);

  if (!d) {
    return { text: "موعد غير محدد", cls: "manual" };
  }

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
    cls: overdue
      ? "late"
      : (+d - Date.now() <= 259200000 ? "due" : "")
  };
}

function message(id, t) {
  const el = $(id);
  if (el) el.textContent = t;
}

function friendly(e) {
  return ({
    "auth/invalid-credential": "البريد أو كلمة المرور غير صحيحة.",
    "auth/email-already-in-use": "البريد مستخدم بالفعل.",
    "auth/weak-password": "كلمة المرور لازم تكون 6 أحرف على الأقل.",
    "auth/invalid-email": "راجع البريد الإلكتروني.",
    "auth/too-many-requests": "محاولات كتير. استنى شوية وجرب تاني.",
    "permission-denied": "الصلاحيات مرفوضة. راجع قواعد Firestore."
  })[e?.code] || e?.message || "حصل خطأ غير متوقع.";
}

/* استعادة كلمة المرور */
const forgotPasswordBtn = $("forgotPasswordBtn");

if (forgotPasswordBtn) {
  forgotPasswordBtn.addEventListener("click", async () => {
    const emailInput = $("email");
    const email = emailInput?.value.trim();

    if (!email) {
      message("authMsg", "اكتب بريدك الإلكتروني الأول.");
      emailInput?.focus();
      return;
    }

    message("authMsg", "جارٍ إرسال رسالة استعادة كلمة المرور...");
    forgotPasswordBtn.disabled = true;

    try {
      await sendPasswordResetEmail(auth, email);

      message(
        "authMsg",
        "لو البريد مسجل، هتوصلك رسالة لاستعادة كلمة المرور. راجع صندوق الوارد والرسائل غير المرغوب فيها."
      );
    } catch (e) {
      if (e.code === "auth/invalid-email") {
        message("authMsg", "صيغة البريد الإلكتروني غير صحيحة.");
      } else if (e.code === "auth/too-many-requests") {
        message("authMsg", "محاولات كتير. استنى شوية وجرب تاني.");
      } else {
        message(
          "authMsg",
          "تعذر إرسال الرسالة. تأكد من إعدادات Firebase Authentication."
        );
      }
    } finally {
      forgotPasswordBtn.disabled = false;
    }
  });
}

async function load() {
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
  const eligible = records.filter(
    r => !r.manualStatus && dueDate(r)
  );

  const groups = new Map();

  for (const r of records) {
    const phone = String(r.phone || "").replace(/\s/g, "");

    if (!groups.has(phone)) groups.set(phone, []);
    groups.get(phone).push(r);
  }

  $("totalCount").textContent = groups.size;

  $("todayCount").textContent = eligible.filter(
    r => dueDate(r)?.toDateString() === new Date().toDateString()
  ).length;

  $("lateCount").textContent = eligible.filter(
    r => +dueDate(r) < Date.now()
  ).length;

  $("soonCount").textContent = eligible.filter(r => {
    const n = +dueDate(r) - Date.now();
    return n >= 0 && n <= 259200000;
  }).length;

  const searchText = $("search").value.trim().toLowerCase();

  const visible = [...groups.entries()].filter(([phone, items]) => {
    const first = items[0];

    const matchesSearch =
      `${first.name || ""} ${phone}`.toLowerCase().includes(searchText);

    const matchesFilter =
      filter === "all" ||
      items.some(r => {
        if (filter === "due") {
          const d = dueDate(r);
          return d && +d <= Date.now();
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
          <button class="btn secondary" data-action="done" data-id="${esc(r.id)}">
            تمت العملية
          </button>
          <button class="btn secondary" data-action="edit" data-id="${esc(r.id)}">
            تعديل
          </button>
          <button class="btn danger" data-action="delete" data-id="${esc(r.id)}">
            حذف
          </button>
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
          <div>
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
}

$("numberForm").addEventListener("submit", async e => {
  e.preventDefault();

  const id = $("editId").value;
  const phone = $("phone").value.trim().replace(/\s+/g, "");
  const name = $("personName").value.trim();
  const kind = $("kind").value;
  const lastDate = $("lastDate").value;
  const manualStatus = $("manualStatus").value;

  if (!phone || !lastDate) return;

  const data = {
    phone,
    name,
    kind,
    lastDate,
    cycleStart: lastDate,
    manualStatus: manualStatus || "",
    anchorDay: new Date(lastDate).getDate(),
    updatedAt: serverTimestamp()
  };

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
  }
});

$("cancelEdit").onclick = resetForm;

$("records").addEventListener("click", async e => {
  const b = e.target.closest("button[data-action]");
  if (!b) return;

  const r = records.find(x => x.id === b.dataset.id);
  if (!r) return;

  if (b.dataset.action === "edit") {
    $("editId").value = r.id;
    $("personName").value = r.name || "";
    $("phone").value = r.phone || "";
    $("kind").value = r.kind || "discount";
    $("lastDate").value = (r.lastDate || "").slice(0, 16);
    $("manualStatus").value = r.manualStatus || "";
    $("formTitle").textContent = "تعديل السجل";
    $("cancelEdit").classList.remove("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (b.dataset.action === "done") {
    if (!confirm("تأكيد تسجيل العملية الآن؟")) return;

    const now = localInputValue();

    try {
      await updateDoc(
        doc(db, "users", currentUser.uid, "numbers", r.id),
        {
          lastDate: now,
          cycleStart: now,
          anchorDay: new Date(now).getDate(),
          manualStatus: "",
          updatedAt: serverTimestamp()
        }
      );

      await load();
    } catch (e) {
      alert(friendly(e));
    }
  }

  if (b.dataset.action === "delete") {
    if (!confirm(
      `حذف متابعة ${r.kind === "discount" ? "الخصم" : "الميني باك"} للرقم ${r.phone} نهائيًا؟`
    )) return;

    try {
      await deleteDoc(
        doc(db, "users", currentUser.uid, "numbers", r.id)
      );
      await load();
    } catch (e) {
      alert(friendly(e));
    }
  }
});

$("search").addEventListener("input", render);

document.querySelectorAll(".filter").forEach(b => {
  b.onclick = () => {
    filter = b.dataset.filter;

    document.querySelectorAll(".filter").forEach(x => {
      x.classList.toggle("active", x === b);
    });

    render();
  };
});

$("exportBtn").onclick = () => {
  const cols = [
    "id", "name", "phone", "kind", "lastDate",
    "cycleStart", "manualStatus", "anchorDay",
    "createdAt", "updatedAt"
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
};

$("auditBtn").onclick = () => {
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
};

$("importBtn").onclick = () => {
  alert(
    "قائمة الأرقام الأصلية غير موجودة في هذا الملف. لم تتم إضافة أو حذف أي سجل."
  );
};

$("loginBtn").onclick = async () => {
  message("authMsg", "جارٍ تسجيل الدخول...");

  try {
    await signInWithEmailAndPassword(
      auth,
      $("email").value.trim(),
      $("password").value
    );

    message("authMsg", "");
  } catch (e) {
    message("authMsg", friendly(e));
  }
};

$("signupBtn").onclick = async () => {
  message("authMsg", "جارٍ إنشاء الحساب...");

  try {
    await createUserWithEmailAndPassword(
      auth,
      $("email").value.trim(),
      $("password").value
    );

    message("authMsg", "تم إنشاء الحساب.");
  } catch (e) {
    message("authMsg", friendly(e));
  }
};

$("authForm").addEventListener("submit", e => {
  e.preventDefault();
  $("loginBtn").click();
});

$("logoutBtn").onclick = () => signOut(auth);

onAuthStateChanged(auth, async user => {
  currentUser = user;

  $("authView").classList.toggle("hidden", !!user);
  $("appView").classList.toggle("hidden", !user);

  if (user) {
    $("userBadge").textContent = user.email || "متصل";
    resetForm();

    try {
      await load();

      if (tickTimer) clearInterval(tickTimer);

      tickTimer = setInterval(() => {
        for (const r of records) {
          const el = document.querySelector(
            `[data-countdown="${CSS.escape(r.id)}"]`
          );

          if (!el) continue;

          const c = countdown(r);
          el.innerHTML = c.text;
          el.className = `countdown ${c.cls}`;
        }
      }, 1000);
    } catch (e) {
      message("formMsg", friendly(e));
    }
  } else {
    records = [];

    if (tickTimer) clearInterval(tickTimer);
  }
});
