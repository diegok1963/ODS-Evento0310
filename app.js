function abreviarLiceo(nombre) {
  if (!nombre) return "";
  var t = nombre.trim();
  if (t.length <= 8 && t === t.toUpperCase() && !/\s/.test(t)) return t;
  return t.split(/\s+/).map(function(w){ return w.charAt(0).toUpperCase(); }).join("");
}

// ── UTILIDADES ────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function formatFecha(f) {
  if (!f) return "-";
  var d = new Date(f.replace(" ","T"));
  if (isNaN(d)) return f;
  return d.toLocaleDateString("es-AR",{day:"2-digit",month:"2-digit",year:"numeric"}) + " " +
         d.toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"});
}

function nowISO() {
  var d = new Date();
  var p = function(n){ return String(n).padStart(2,"0"); };
  return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate())+" "+p(d.getHours())+":"+p(d.getMinutes())+":"+p(d.getSeconds());
}

function toast(msg, type) {
  var c = document.getElementById("toast-container");
  var t = document.createElement("div");
  t.className = "toast " + (type||"info");
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(function(){
    t.style.opacity = "0"; t.style.transform = "translateX(40px)"; t.style.transition = ".3s";
    setTimeout(function(){ t.remove(); }, 300);
  }, 3000);
}

function countUp(id, target) {
  var el = document.getElementById(id);
  if (!el) return;
  var start = 0, duration = 700, startTime = null;
  el.textContent = 0;
  if (target === 0) return;
  function step(ts) {
    if (!startTime) startTime = ts;
    var progress = Math.min((ts - startTime) / duration, 1);
    var ease = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(start + (target - start) * ease);
    if (progress < 1) requestAnimationFrame(step);
    else el.textContent = target;
  }
  requestAnimationFrame(step);
}


// ── CARGA DESDE GOOGLE SHEETS ─────────────────────────────────────────────────
var GSHEET_URL = "https://docs.google.com/spreadsheets/d/1YF2gBfRzrnxlfdrW6yiSWr6Fvn8a4MidI6dZtbSva1s/gviz/tq?tqx=out:csv&gid=996470594";

function cargarDesdeSheets(callback) {
  fetch(GSHEET_URL)
    .then(function(res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.text();
    })
    .then(function(csv) {
      var lineas = csv.replace(/\r\n/g,"\n").replace(/\r/g,"\n").split("\n");
      var nuevas = [];
      // Saltar filas 0,1,2 (encabezados de Google Forms) - datos desde fila 3
      for (var i=3; i<lineas.length; i++) {
        var linea = lineas[i].trim();
        if (!linea) continue;
        // Parsear CSV simple
        var cols = [];
        var campo = ""; var enQ = false;
        for (var c=0; c<linea.length; c++) {
          var ch = linea[c];
          if (ch==='"') { enQ=!enQ; }
          else if (ch===',' && !enQ) { cols.push(campo.trim()); campo=""; }
          else { campo+=ch; }
        }
        cols.push(campo.trim());
        if (cols.length < 4) continue;
        var nombre = cols[3].replace(/^"|"$/g,"").trim();
        if (!nombre || nombre.length < 2) continue;
        if (nombre.toLowerCase().indexOf("nombre")>=0 && nombre.toLowerCase().indexOf("apellido")>=0) continue;
        var liceo = cols[1].replace(/^"|"$/g,"").trim();
        if (liceo.toLowerCase().indexOf("selecciona")>=0) continue;
        var nroPromo = cols[2].replace(/^"|"$/g,"").trim();
        if (!nroPromo || isNaN(parseFloat(nroPromo))) continue;
        var existe = reservas.some(function(r){
          return r.nombre.trim().toLowerCase()===nombre.toLowerCase() &&
                 String(r.nroPromocion||"").trim()===nroPromo;
        });
        if (existe) continue;
        var amigos = cols.length>6 ? cols[6].replace(/^"|"$/g,"").trim() : "";
        var noAmigos = ["no","ninguno","ninguna","n/a","-","sin amigos","solo","nadie","a confirmar",""];
        if (noAmigos.indexOf(amigos.toLowerCase()) >= 0) amigos = "";
        nuevas.push({
          id: nextId++,
          fecha: cols[0].replace(/^"|"$/g,"").trim(),
          liceo: liceo,
          nroPromocion: nroPromo,
          nombre: nombre,
          email: cols.length>4 ? cols[4].replace(/^"|"$/g,"").trim() : "",
          telefono: cols.length>5 ? cols[5].replace(/^"|"$/g,"").trim() : "",
          amigos: amigos,
          abonos: {}, estados: {}, mesa: ""
        });
      }
      if (nuevas.length > 0) {
        reservas = reservas.concat(nuevas);
        guardarReservas(); renderTable();
        toast(nuevas.length + " reservas cargadas desde Google Sheets", "success");
      } else {
        toast("No hay reservas nuevas en Google Sheets", "info");
      }
      if (callback) callback(nuevas.length);
    })
    .catch(function(err) {
      console.error("Error Sheets:", err);
      if (callback) callback(0);
    });
}

// ── DATOS ─────────────────────────────────────────────────────────────────────
function cargarReservas() {
  try {
    var d = localStorage.getItem("karaoke_reservas");
    if (d) return JSON.parse(d);
  } catch(e) {}
  return [];
}

function guardarReservas() {
  try { localStorage.setItem("karaoke_reservas", JSON.stringify(reservas)); } catch(e) {}
}

var reservas = cargarReservas();
var nextId = reservas.length > 0 ? Math.max.apply(null, reservas.map(function(r){ return r.id; })) + 1 : 1;
var editingId = null;
var deletingId = null;
var detailId = null;
var currentPage = 1;
var PAGE_SIZE = 10;

// ── ESTADÍSTICAS ──────────────────────────────────────────────────────────────
function calcStats() {
  var total = reservas.length;
  var totalPersonas = 0, presentes = 0, enEspera = 0;
  for (var i = 0; i < reservas.length; i++) {
    var r = reservas[i];
    var amigosArr = r.amigos ? r.amigos.split(",").map(function(a){ return a.trim(); }).filter(Boolean) : [];
    var personas = amigosArr.length + 1;
    totalPersonas += personas;
    for (var k = 0; k < personas; k++) {
      if (r.estados && r.estados["p"+k] === "presente") presentes++;
      else enEspera++;
    }
  }
  return { total: total, totalPersonas: totalPersonas, presentes: presentes, enEspera: enEspera,
           promedio: total > 0 ? (totalPersonas/total).toFixed(1) : "0" };
}

function updateStats() {
  var s = calcStats();
  document.getElementById("stat-total").textContent = s.total;
  document.getElementById("stat-asistentes").textContent = s.totalPersonas;
  document.getElementById("stat-promedio").textContent = s.promedio;
  countUp("stat-presentes", s.presentes);
  countUp("stat-espera", s.enEspera);
  document.getElementById("badge-total").textContent = s.total + (s.total === 1 ? " reserva" : " reservas");
}

// ── FILTRO Y ORDEN ────────────────────────────────────────────────────────────
function getFiltered() {
  var q = document.getElementById("search-input").value.toLowerCase().trim();
  if (!q) return reservas;
  return reservas.filter(function(r) {
    var sigla = abreviarLiceo(r.liceo||"").toLowerCase();
    return r.nombre.toLowerCase().indexOf(q) >= 0 ||
           (r.telefono||"").toLowerCase().indexOf(q) >= 0 ||
           (r.amigos||"").toLowerCase().indexOf(q) >= 0 ||
           (r.nroPromocion||"").toLowerCase().indexOf(q) >= 0 ||
           sigla.indexOf(q) >= 0 ||
           (r.liceo||"").toLowerCase().indexOf(q) >= 0;
  });
}

function getSorted(arr) {
  return arr.slice().sort(function(a, b) {
    var la=(a.liceo||"").toLowerCase(), lb=(b.liceo||"").toLowerCase();
    if(la<lb) return -1; if(la>lb) return 1;
    var na=parseFloat(a.nroPromocion||""), nb=parseFloat(b.nroPromocion||"");
    if(!isNaN(na)&&!isNaN(nb)) return na-nb;
    return new Date(a.fecha||"") - new Date(b.fecha||"");
  });
}

// ── RENDER TABLA ──────────────────────────────────────────────────────────────
function renderTable() {
  var filtered = getSorted(getFiltered());
  var total = filtered.length;
  var totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  var start = (currentPage - 1) * PAGE_SIZE;
  var page = filtered.slice(start, start + PAGE_SIZE);
  var cards = document.getElementById("cards");

  if (page.length === 0) {
    cards.innerHTML = '<div class="empty-state"><span class="empty-icon">&#127925;</span>No se encontraron reservas</div>';
  } else {
    var html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:18px;margin-bottom:28px">';
    for (var i = 0; i < page.length; i++) {
      var r = page[i];
      var num = start + i + 1;
      var amigosArr = r.amigos ? r.amigos.split(",").map(function(a){ return a.trim(); }).filter(function(a){
        if (!a) return false;
        var t = a.trim().toLowerCase();
        var no = ["no","ninguno","ninguna","n/a","-","sin amigos","solo","nadie","a confirmar",""];
        if (no.indexOf(t) >= 0) return false;
        return a.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ]/g,"").length >= 2;
      }) : [];
      var estados = r.estados || {};
      var liceoAbrev = abreviarLiceo(r.liceo || "");
      var cancelStyle = r.cancelada ? "opacity:.5;filter:grayscale(.6)" : "";
      var textoHeader = (liceoAbrev ? liceoAbrev + " " : "") + "Prom. " + (r.nroPromocion || "-");
      var totalPersonas = amigosArr.length + 1;

      function makeRow(rid, pk, nombre, isTitular) {
        var rx = reservas.find(function(x){ return x.id === rid; });
        var abono = rx && rx.abonos && rx.abonos[pk] === "abono";
        var presente = rx && rx.estados && rx.estados[pk] === "presente";
        var bg = abono
          ? (isTitular ? "background:rgba(34,197,94,.18);border-left:3px solid #22c55e" : "background:rgba(34,197,94,.10);border-left:3px solid rgba(34,197,94,.6)")
          : (isTitular ? "background:rgba(239,68,68,.15);border-left:3px solid #ef4444" : "background:rgba(239,68,68,.08);border-left:3px solid rgba(239,68,68,.5)");
        var nHtml = isTitular ? "<strong style=\"color:#111\">" + esc(nombre) + "</strong>" : "<span style=\"color:#111\">" + esc(nombre) + "</span>";
        var presBtn = "<button class=\"btn-estado " + (presente ? "btn-success" : "btn-warning") + "\"" +
          (abono ? " onclick=\"togglePersona(" + rid + ",\'" + pk + "\')\"" : " onclick=\"toast(\'No puede marcar presente: no abon\u00f3\',\'error\')\" style=\"opacity:.5;cursor:not-allowed\"") +
          ">" + (presente ? "&#10003;" : "&#9201;") + "</button>";
        var aboBtn = "<button class=\"btn-estado " + (abono ? "btn-success" : "btn-danger") + "\" onclick=\"toggleAbono(" + rid + ",\'" + pk + "\')\" style=\"font-size:.62rem;padding:1px 5px\">" +
          (abono ? "&#36; Abon\u00f3" : "&#36; No abon\u00f3") + "</button>";
        return "<div class=\"amigo-row\" style=\"" + bg + ";display:flex;align-items:center;gap:4px;flex-wrap:wrap;border-radius:4px;margin-bottom:2px\">" + presBtn + " " + nHtml + " " + aboBtn + "</div>";
      }

      var integrantesHtml = "<div style=\"font-size:.72rem;color:#22d3ee;font-weight:700;padding:3px 0 2px\">" + totalPersonas + " asistente" + (totalPersonas !== 1 ? "s" : "") + "</div>";
      integrantesHtml += makeRow(r.id, "p0", r.nombre, true);
      for (var j = 0; j < amigosArr.length; j++) {
        integrantesHtml += makeRow(r.id, "p"+(j+1), amigosArr[j], false);
      }
      integrantesHtml += "<div style=\"display:flex;gap:6px;flex-wrap:wrap;padding:6px 0 4px;border-top:1px solid rgba(0,0,0,.08);margin-top:4px\">";
      integrantesHtml += "<button class=\"btn btn-info btn-sm\" onclick=\"openDetail(" + r.id + ")\" style=\"color:#000\">&#128065; Ver</button>";
      integrantesHtml += "<button class=\"btn btn-wa btn-sm\" onclick=\"enviarWhatsApp(" + r.id + ")\">&#128172; WhatsApp</button>";
      integrantesHtml += "<button class=\"btn btn-success btn-sm\" onclick=\"openModal(" + r.id + ")\">&#9999;&#65039; Editar</button>";
      integrantesHtml += "<button class=\"" + (r.cancelada ? "btn btn-warning btn-sm" : "btn btn-danger btn-sm") + "\" onclick=\"toggleCancelar(" + r.id + ")\" style=\"color:#000\">" + (r.cancelada ? "&#9654;&#65039; Restaurar" : "&#10006; Cancelar") + "</button>";
      integrantesHtml += "<button class=\"btn btn-danger btn-sm\" onclick=\"openConfirm(" + r.id + ")\" style=\"color:#000\">&#128465; Eliminar</button>";
      integrantesHtml += "</div>";

      html += "<div class=\"reserva-card\" style=\"" + cancelStyle + "\">";
      html += "<div class=\"card-top\">";
      html += "<div style=\"width:100%\">";
      html += "<div style=\"display:flex;align-items:center;justify-content:space-between;gap:10px\">";
      html += "<span style=\"font-size:.85rem;color:#fff;font-weight:700\">" + esc(textoHeader) + (r.cancelada ? " <span style=\"font-size:.65rem;background:rgba(239,68,68,.2);border:1px solid rgba(239,68,68,.5);color:#f87171;border-radius:10px;padding:1px 7px\">ELIMINADA</span>" : "") + "</span>";
      html += "<span style=\"font-size:.68rem;color:#22d3ee;font-weight:700;background:rgba(6,182,212,.15);border:1px solid rgba(6,182,212,.4);border-radius:10px;padding:1px 8px\">" + totalPersonas + " asist.</span>";
      html += "</div></div></div>";
      html += "<div class=\"card-body\">";
      html += "<div class=\"card-field\"><span class=\"card-field-icon\">&#128101;</span>";
      html += "<div style=\"width:100%\"><div class=\"card-field-label\">Integrantes</div>";
      html += "<div class=\"amigos-list\">" + integrantesHtml + "</div></div></div>";
      html += "</div></div>";
    }
    html += "</div>";
    cards.innerHTML = html;
  }


  // Paginación
  document.getElementById("page-info").textContent = total === 0 ? "Sin resultados" :
    "Mostrando " + (start+1) + "-" + Math.min(start+PAGE_SIZE, total) + " de " + total;
  var pageBtns = document.getElementById("page-btns");
  pageBtns.innerHTML = "";
  function addBtn(label, pg, disabled, active) {
    var b = document.createElement("button");
    b.className = "page-btn" + (active ? " active" : "");
    b.textContent = label;
    b.disabled = disabled;
    b.onclick = (function(p){ return function(){ currentPage = p; renderTable(); }; })(pg);
    pageBtns.appendChild(b);
  }
  addBtn("<", currentPage-1, currentPage===1, false);
  for (var p = 1; p <= totalPages; p++) addBtn(p, p, false, p===currentPage);
  addBtn(">", currentPage+1, currentPage===totalPages, false);

  updateStats();
  renderCharts();
}

// ── MODAL NUEVA/EDITAR ────────────────────────────────────────────────────────
function openModal(id) {
  editingId = id || null;
  var iconEl = document.getElementById("modal-icon");
  if (iconEl) iconEl.textContent = id ? "\u270f\ufe0f" : "\ud83c\udfa4";
  document.getElementById("modal-title").textContent = id ? "Editar Reserva" : "Nueva Reserva";
  if (id) {
    var r = reservas.find(function(x){ return x.id === id; });
    if (!r) return;
    document.getElementById("f-nombre").value = r.nombre;
    var nroEl = document.getElementById("f-nropromocion"); if (nroEl) nroEl.value = r.nroPromocion || "";
    var liceoEl = document.getElementById("f-liceo"); if (liceoEl) liceoEl.value = r.liceo || "";
    document.getElementById("f-telefono").value = r.telefono || "";
    document.getElementById("f-amigos").value = r.amigos || "";
  } else {
    document.getElementById("f-nombre").value = "";
    var nroEl2 = document.getElementById("f-nropromocion"); if (nroEl2) nroEl2.value = "";
    var liceoEl2 = document.getElementById("f-liceo"); if (liceoEl2) liceoEl2.value = "";
    document.getElementById("f-telefono").value = "";
    document.getElementById("f-amigos").value = "";
  }
  document.getElementById("modal-form").classList.add("open");
  setTimeout(function(){ document.getElementById("f-nombre").focus(); }, 100);
}

function closeModal() {
  document.getElementById("modal-form").classList.remove("open");
  editingId = null;
}

function saveReserva() {
  var nombre = document.getElementById("f-nombre").value.trim();
  var nroPromocion = document.getElementById("f-nropromocion") ? document.getElementById("f-nropromocion").value.trim() : "";
  var liceo = document.getElementById("f-liceo") ? document.getElementById("f-liceo").value.trim() : "";
  var telefono = document.getElementById("f-telefono").value.trim();
  var amigos = document.getElementById("f-amigos").value.trim();
  if (!nombre) { toast("El nombre es obligatorio", "error"); return; }
  if (editingId) {
    var idx = reservas.findIndex(function(r){ return r.id === editingId; });
    if (idx !== -1) { reservas[idx].nombre = nombre; reservas[idx].nroPromocion = nroPromocion; reservas[idx].liceo = liceo; reservas[idx].telefono = telefono; reservas[idx].amigos = amigos; }
    toast("Reserva actualizada", "success");
  } else {
    reservas.push({ id: nextId++, fecha: nowISO(), nombre: nombre, nroPromocion: nroPromocion, liceo: liceo, telefono: telefono, amigos: amigos, abonos: {}, estados: {}, mesa: '' });
    toast("Nueva reserva agregada", "success");
  }
  closeModal();
  guardarReservas();
  renderTable();
  exportExcel();
}

// ── ACTUALIZAR MESA ──────────────────────────────────────────────────────────
function updateMesa(id, valor) {
  var r = reservas.find(function(x){ return x.id === id; });
  if (r) { r.mesa = valor.trim(); guardarReservas(); }
}

// ── CANCELAR RESERVA
function toggleCancelar(id) {
  var r = reservas.find(function(x){ return x.id === id; });
  if (!r) return;
  r.cancelada = !r.cancelada;
  guardarReservas(); renderTable();
  toast(r.cancelada ? "Reserva marcada como ELIMINADA" : "Reserva restaurada", r.cancelada ? "error" : "success");
}

// ── TOGGLE ABONO
function toggleAbono(reservaId, personaKey) {
  var r = reservas.find(function(x){ return x.id === reservaId; });
  if (!r) return;
  if (!r.abonos) r.abonos = {};
  r.abonos[personaKey] = r.abonos[personaKey] === "abono" ? "no_abono" : "abono";
  if (r.abonos[personaKey] === "no_abono" && r.estados && r.estados[personaKey] === "presente") {
    r.estados[personaKey] = "espera";
  }
  guardarReservas(); renderTable();
}

// ── TOGGLE ESTADO PERSONA ─────────────────────────────────────────────────────
function togglePersona(reservaId, personaKey) {
  var r = reservas.find(function(x){ return x.id === reservaId; });
  if (!r) return;
  if (!r.estados) r.estados = {};
  r.estados[personaKey] = r.estados[personaKey] === "presente" ? "espera" : "presente";
  guardarReservas();
  renderTable();
}

// ── MODAL DETALLE ─────────────────────────────────────────────────────────────
function openDetail(id) {
  detailId = id;
  var r = reservas.find(function(x){ return x.id === id; });
  if (!r) return;
  document.getElementById("detail-title").textContent = r.nombre;
  var amigosArr = r.amigos ? r.amigos.split(",").map(function(a){ return a.trim(); }).filter(Boolean) : [];
  var chips = amigosArr.map(function(a){
    return '<div class="amigo-row">&#128100; ' + esc(a) + '</div>';
  }).join("") || '<span style="color:var(--muted)">Sin amigos</span>';
  document.getElementById("detail-body").innerHTML =
    '<div class="form-group"><label>Fecha y Hora</label><div style="padding:9px 12px;background:var(--input-bg);border-radius:10px;border:1px solid var(--border);color:var(--muted)">' + formatFecha(r.fecha) + '</div></div>' +
    '<div class="form-row"><div class="form-group"><label>Nombre</label><div style="padding:9px 12px;background:var(--input-bg);border-radius:10px;border:1px solid var(--border);color:#e879f9;font-weight:700">' + esc(r.nombre) + '</div></div>' +
    '<div class="form-group"><label>Teléfono</label><div style="padding:9px 12px;background:var(--input-bg);border-radius:10px;border:1px solid var(--border);color:#a78bfa;font-family:monospace">' + esc(r.telefono) + '</div></div></div>' +
    '<div class="form-group"><label>Amigos (' + amigosArr.length + ')</label><div class="amigos-list">' + chips + '</div></div>';
  document.getElementById("modal-detail").classList.add("open");
}

function closeDetail() { document.getElementById("modal-detail").classList.remove("open"); detailId = null; }
function editFromDetail() { var id = detailId; closeDetail(); openModal(id); }

// ── MODAL CONFIRMAR ELIMINAR ──────────────────────────────────────────────────
function openConfirm(id) {
  deletingId = id;
  var r = reservas.find(function(x){ return x.id === id; });
  if (r) document.getElementById("confirm-desc").textContent = 'Se eliminará la reserva de "' + r.nombre + '". Esta acción no se puede deshacer.';
  document.getElementById("modal-confirm").classList.add("open");
}

function closeConfirm() { document.getElementById("modal-confirm").classList.remove("open"); deletingId = null; }

function confirmDelete() {
  if (deletingId === null) return;
  var r = reservas.find(function(x){ return x.id === deletingId; });
  reservas = reservas.filter(function(x){ return x.id !== deletingId; });
  closeConfirm();
  guardarReservas();
  renderTable();
  toast('Reserva de "' + (r ? r.nombre : "") + '" eliminada', "info");
}

// ── WHATSAPP ──────────────────────────────────────────────────────────────────
function enviarWhatsApp(id) {
  var r = reservas.find(function(x){ return x.id === id; });
  if (!r) return;
  var tel = r.telefono.replace(/[^0-9]/g, "");
  if (!tel) { toast("No hay número de teléfono registrado", "error"); return; }
  if (tel.length <= 10) tel = "549" + tel;
  var amigosArr = r.amigos ? r.amigos.split(",").map(function(a){ return a.trim(); }).filter(Boolean) : [];
  var nl = "\n";
  var eventoFecha = document.getElementById("evento-fecha").value;
  var eventoHora = document.getElementById("evento-hora").value;
  var eventoStr = "";
  if (eventoFecha) {
    var d = new Date(eventoFecha + "T00:00:00");
    eventoStr = d.toLocaleDateString("es-AR",{day:"2-digit",month:"2-digit",year:"numeric"});
  }
  if (eventoHora) eventoStr += (eventoStr ? " a las " : "") + eventoHora + "hs";
  var partes = [
    "Hola " + r.nombre + "!",
    "Tu reserva en *Orden del Sol* esta confirmada!"
  ];
  if (eventoStr) partes.push("", "Fecha del evento: " + eventoStr);
  if (amigosArr.length > 0) partes.push("Grupo: " + amigosArr.join(", "));
  partes.push("", "Te esperamos!");
  var url = "https://wa.me/" + tel + "?text=" + encodeURIComponent(partes.join(nl));
  window.open(url, "_blank");
}

// ── EXPORTAR EXCEL ────────────────────────────────────────────────────────────
function exportExcel() {
  if (typeof XLSX === "undefined") { toast("Librería Excel no disponible", "error"); return; }
  var data = [["Marca temporal","Nombre y Apellido","Nro de Teléfono de Contacto","Amigos"]];
  for (var i = 0; i < reservas.length; i++) {
    data.push([reservas[i].fecha, reservas[i].nombre, reservas[i].telefono, reservas[i].amigos||""]);
  }
  var wb = XLSX.utils.book_new();
  var ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = [{wch:22},{wch:28},{wch:24},{wch:60}];
  XLSX.utils.book_append_sheet(wb, ws, "Reservas");
  XLSX.writeFile(wb, "Orden del Sol_Reservas_" + new Date().toISOString().slice(0,10) + ".xlsx");
  toast("Excel exportado correctamente", "success");
}

// ── IMPORTAR EXCEL ────────────────────────────────────────────────────────────
function importExcel(event) {
  var file = event.target.files[0];
  if (!file) return;
  toast("Leyendo archivo...", "info");
  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var data = new Uint8Array(e.target.result);
      var wb = XLSX.read(data, {type:"array", cellDates:true});
      var ws = wb.Sheets[wb.SheetNames[0]];
      var allRows = XLSX.utils.sheet_to_json(ws, {header:1, defval:""});
      if (!allRows || allRows.length < 2) { toast("El archivo no tiene datos", "error"); return; }
      var headers = allRows[0];
      var iF=0, iN=1, iT=2, iA=3;
      for (var h = 0; h < headers.length; h++) {
        var hh = String(headers[h]).toLowerCase();
        if (hh.indexOf("temporal")>=0 || hh.indexOf("marca")>=0) { iF=h; }
        else if (hh.indexOf("tel")>=0 || hh.indexOf("contacto")>=0) { iT=h; }
        else if (hh.indexOf("venis")>=0 || hh.indexOf("separado")>=0 || hh.indexOf("coma")>=0) { iA=h; }
        else if ((hh.indexOf("nombre")>=0 || hh.indexOf("apellido")>=0) && hh.indexOf("venis")<0 && hh.indexOf("amigo")<0 && hh.indexOf("separado")<0) { iN=h; }
      }
      var nuevas = [];
      for (var i = 1; i < allRows.length; i++) {
        var row = allRows[i];
        if (!row || row.length === 0) continue;
        var nombre = String(row[iN]||"").trim();
        if (!nombre) continue;
        // Saltar filas que son encabezados
        if (nombre.toLowerCase() === "nombre y apellido") continue;
        if (nombre.toLowerCase().indexOf("nombre") >= 0 && nombre.toLowerCase().indexOf("apellido") >= 0) continue;
        // Saltar filas con liceo inválido
        var liceoVal = String(row[1]||"").trim().toLowerCase();
        if (liceoVal === "selecciona tu liceo" || liceoVal.indexOf("selecciona") >= 0) continue;
        var fechaRaw = row[iF];
        var fecha = "";
        if (fechaRaw instanceof Date) {
          fecha = fechaRaw.toISOString().replace("T"," ").slice(0,19);
        } else if (fechaRaw) {
          fecha = String(fechaRaw);
        }
        nuevas.push({id:nextId++, fecha:fecha, nombre:nombre, telefono:String(row[iT]||"").trim(), amigos:String(row[iA]||"").trim(), estados:{}, mesa:""});
      }
      if (nuevas.length === 0) { toast("No se encontraron reservas validas", "error"); return; }
      window._importNuevas = nuevas;
      mostrarOpcionesImport(nuevas.length);
    } catch(err) {
      toast("Error al importar: " + err.message, "error");
    }
    event.target.value = "";
  };
  reader.readAsArrayBuffer(file);
}


// ── GRÁFICOS ──────────────────────────────────────────────────────────────────
var chartDona = null, chartDias = null, chartHoras = null;

function renderCharts() {
  if (typeof Chart === "undefined") return;
  var s = calcStats();
  var presentes = s.presentes, enEspera = s.enEspera;
  var total = presentes + enEspera;
  var pct = total > 0 ? Math.round(presentes/total*100) : 0;

  var diasMap = {}, horasMap = {};
  for (var i = 0; i < reservas.length; i++) {
    var f = reservas[i].fecha || "";
    var dia = f.slice(0,10) || "Sin fecha";
    diasMap[dia] = (diasMap[dia]||0) + 1;
    var hora = f.length >= 13 ? f.slice(11,13) + ":00" : "Sin hora";
    horasMap[hora] = (horasMap[hora]||0) + 1;
  }
  var diasKeys = Object.keys(diasMap).sort();
  var diasLabels = diasKeys.map(function(k){
    if (k === "Sin fecha") return k;
    var d = new Date(k + "T00:00:00");
    return d.toLocaleDateString("es-AR",{day:"2-digit",month:"2-digit"});
  });
  var diasVals = diasKeys.map(function(k){ return diasMap[k]; });
  var horasKeys = Object.keys(horasMap).sort();
  var horasVals = horasKeys.map(function(k){ return horasMap[k]; });

  var scaleOpts = {
    x: { ticks: { color: "#9ca3af" }, grid: { color: "rgba(255,255,255,0.05)" } },
    y: { ticks: { color: "#9ca3af", stepSize: 1 }, grid: { color: "rgba(255,255,255,0.05)" }, beginAtZero: true }
  };

  // Dona
  // Actualizar texto central de la dona
  var pctEl = document.getElementById("dona-pct");
  if (pctEl) {
    pctEl.innerHTML = '<span style="font-size:1.6rem;font-weight:800;color:#e879f9;display:block;line-height:1">' + pct + '%</span><span style="font-size:.7rem;color:#9ca3af">presentes</span>';
  }

  var ctxDona = document.getElementById("chart-dona");
  if (ctxDona) {
    if (chartDona) {
      chartDona.data.datasets[0].data = [presentes||0.001, enEspera||0.001];
      chartDona.update("none");
    } else {
      chartDona = new Chart(ctxDona, {
        type: "doughnut",
        data: {
          labels: ["Presentes","En Espera"],
          datasets: [{ data: [presentes||0.001, enEspera||0.001], backgroundColor: ["rgba(34,197,94,.8)","rgba(245,158,11,.8)"], borderColor: ["#22c55e","#f59e0b"], borderWidth: 2 }]
        },
        options: { responsive: true, maintainAspectRatio: false, cutout: "65%",
          plugins: { legend: { position: "bottom", labels: { color: "#9ca3af", padding: 14, font: { size: 11 } } } }
        }
      });
    }
  }

  // Barras días
  var ctxDias = document.getElementById("chart-dias");
  if (ctxDias) {
    if (chartDias) {
      chartDias.data.labels = diasLabels;
      chartDias.data.datasets[0].data = diasVals;
      chartDias.update("none");
    } else {
      chartDias = new Chart(ctxDias, {
        type: "bar",
        data: { labels: diasLabels, datasets: [{ label: "Reservas", data: diasVals, backgroundColor: "rgba(192,38,211,.7)", borderColor: "#c026d3", borderWidth: 2, borderRadius: 6 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: scaleOpts }
      });
    }
  }

  // Barras horas
  var ctxHoras = document.getElementById("chart-horas");
  if (ctxHoras) {
    if (chartHoras) {
      chartHoras.data.labels = horasKeys;
      chartHoras.data.datasets[0].data = horasVals;
      chartHoras.update("none");
    } else {
      chartHoras = new Chart(ctxHoras, {
        type: "bar",
        data: { labels: horasKeys, datasets: [{ label: "Reservas", data: horasVals, backgroundColor: "rgba(34,197,94,.7)", borderColor: "#22c55e", borderWidth: 2, borderRadius: 6 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: scaleOpts }
      });
    }
  }
}

// ── EXPORTAR PDF ──────────────────────────────────────────────────────────────
function exportPDF() {
  if (typeof window.jspdf === "undefined") { toast("Librería PDF no disponible", "error"); return; }
  toast("Generando PDF...", "info");
  var doc = new window.jspdf.jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  var pageW = 210, margin = 14, y = 0;

  // Encabezado
  doc.setFillColor(13,13,26);
  doc.rect(0,0,pageW,28,"F");
  doc.setTextColor(232,121,249); doc.setFontSize(20); doc.setFont("helvetica","bold");
  doc.text("Orden del Sol", margin, 12);
  doc.setTextColor(156,163,175); doc.setFontSize(9); doc.setFont("helvetica","normal");
  doc.text("Reporte de Reservas", margin, 19);
  var ahora = new Date();
  var fechaHoy = ahora.toLocaleDateString("es-AR",{day:"2-digit",month:"2-digit",year:"numeric"}) + " " + ahora.toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"});
  doc.text("Generado: " + fechaHoy, pageW-margin, 19, {align:"right"});
  y = 36;

  // Resumen
  var s = calcStats();
  doc.setTextColor(232,121,249); doc.setFontSize(11); doc.setFont("helvetica","bold");
  doc.text("Resumen General", margin, y); y += 6;
  var pct = s.totalPersonas > 0 ? Math.round(s.presentes/s.totalPersonas*100) : 0;
  var stats = [
    ["Total Reservas", s.total],
    ["Total Asistentes", s.totalPersonas],
    ["Prom. por Grupo", s.promedio],
    ["Presentes", s.presentes + " (" + pct + "%)"],
    ["En Espera", s.enEspera + " (" + (100-pct) + "%)"]
  ];
  var colW = (pageW - margin*2) / stats.length;
  stats.forEach(function(st, idx) {
    var x = margin + idx * colW;
    doc.setFillColor(22,22,42); doc.roundedRect(x, y, colW-2, 16, 2, 2, "F");
    doc.setTextColor(232,121,249); doc.setFont("helvetica","bold"); doc.setFontSize(11);
    doc.text(String(st[1]), x+(colW-2)/2, y+7, {align:"center"});
    doc.setTextColor(156,163,175); doc.setFont("helvetica","normal"); doc.setFontSize(7);
    doc.text(st[0], x+(colW-2)/2, y+13, {align:"center"});
  });
  y += 24;

  // Gráficos
  doc.setTextColor(232,121,249); doc.setFontSize(11); doc.setFont("helvetica","bold");
  doc.text("Estadisticas y Graficos", margin, y); y += 4;
  var chartIds = ["chart-dona","chart-dias","chart-horas"];
  var chartTitles = ["Presentes vs En Espera","Reservas por Dia","Reservas por Hora"];
  var chartW = (pageW - margin*2 - 8) / 3;

  function captureChart(idx) {
    if (idx >= chartIds.length) { finalizarPDF(); return; }
    var canvas = document.getElementById(chartIds[idx]);
    if (!canvas) { captureChart(idx+1); return; }
    html2canvas(canvas, {backgroundColor:"#16162a", scale:2}).then(function(c) {
      var imgData = c.toDataURL("image/png");
      var x = margin + idx * (chartW+4);
      doc.setFillColor(22,22,42); doc.roundedRect(x, y, chartW, chartW*0.75+8, 2, 2, "F");
      doc.setTextColor(156,163,175); doc.setFontSize(7);
      doc.text(chartTitles[idx], x+chartW/2, y+5, {align:"center"});
      doc.addImage(imgData, "PNG", x+1, y+7, chartW-2, chartW*0.75-2);
      captureChart(idx+1);
    });
  }

  function finalizarPDF() {
    y += chartW*0.75 + 14;
    doc.setTextColor(232,121,249); doc.setFontSize(11); doc.setFont("helvetica","bold");
    doc.text("Detalle de Reservas", margin, y); y += 6;
    var cols = ["#","Nombre","Teléfono","Fecha","Amigos","Estado"];
    var colWidths = [8,40,28,30,52,20];
    doc.setFillColor(26,0,48); doc.rect(margin, y, pageW-margin*2, 7, "F");
    doc.setTextColor(232,121,249); doc.setFontSize(8); doc.setFont("helvetica","bold");
    var cx = margin;
    cols.forEach(function(col, i){ doc.text(col, cx+2, y+5); cx += colWidths[i]; });
    y += 7;
    reservas.forEach(function(r, idx) {
      if (y > 270) { doc.addPage(); y = 14; }
      var amigosArr = r.amigos ? r.amigos.split(",").map(function(a){ return a.trim(); }).filter(Boolean) : [];
      var totalP = amigosArr.length + 1, pres = 0;
      for (var k=0; k<totalP; k++) { if (r.estados && r.estados["p"+k]==="presente") pres++; }
      doc.setFillColor(idx%2===0?22:28, idx%2===0?22:28, idx%2===0?42:52);
      doc.rect(margin, y, pageW-margin*2, 6, "F");
      doc.setTextColor(241,240,255); doc.setFont("helvetica","normal"); doc.setFontSize(7.5);
      var vals = [String(idx+1), r.nombre.slice(0,22), r.telefono.slice(0,16), (r.fecha||"").slice(0,16), (r.amigos||"Sin amigos").slice(0,28), pres+"/"+totalP+" pres."];
      cx = margin;
      vals.forEach(function(v, i){ doc.text(v, cx+2, y+4.5); cx += colWidths[i]; });
      y += 6;
    });
    doc.setTextColor(156,163,175); doc.setFontSize(7);
    doc.text("Orden del Sol - Reporte generado el " + fechaHoy, pageW/2, 290, {align:"center"});
    doc.save("Orden del Sol_Reporte_" + new Date().toISOString().slice(0,10) + ".pdf");
    toast("PDF generado correctamente", "success");
  }

  captureChart(0);
}

// ── IMPORTAR MODAL ────────────────────────────────────────────────────────────
function mostrarOpcionesImport(cantidad) {
  var c = document.getElementById("toast-container");
  var prev = document.getElementById("import-toast");
  if (prev) prev.remove();
  var t = document.createElement("div");
  t.id = "import-toast";
  t.style.cssText = "background:var(--card2);border:1px solid var(--accent);border-radius:14px;padding:16px 18px;box-shadow:0 8px 30px rgba(0,0,0,.5);min-width:280px;";
  var titulo = document.createElement("div");
  titulo.style.cssText = "font-weight:700;color:#e879f9;margin-bottom:8px";
  titulo.textContent = cantidad + " reservas encontradas";
  var sub = document.createElement("div");
  sub.style.cssText = "font-size:.82rem;color:var(--muted);margin-bottom:12px";
  sub.textContent = "Que queres hacer?";
  var btns = document.createElement("div");
  btns.style.cssText = "display:flex;gap:8px";
  var b1 = document.createElement("button");
  b1.textContent = "Reemplazar";
  b1.style.cssText = "flex:1;padding:8px;background:rgba(239,68,68,.2);border:1px solid rgba(239,68,68,.5);color:#f87171;border-radius:8px;cursor:pointer;font-weight:600;font-size:.82rem";
  b1.onclick = function(){ confirmarImport("reemplazar"); };
  var b2 = document.createElement("button");
  b2.textContent = "+ Agregar";
  b2.style.cssText = "flex:1;padding:8px;background:rgba(34,197,94,.2);border:1px solid rgba(34,197,94,.5);color:#4ade80;border-radius:8px;cursor:pointer;font-weight:600;font-size:.82rem";
  b2.onclick = function(){ confirmarImport("agregar"); };
  btns.appendChild(b1);
  btns.appendChild(b2);
  t.appendChild(titulo);
  t.appendChild(sub);
  t.appendChild(btns);
  c.appendChild(t);
}


function closeImport() {
  document.getElementById("modal-import").classList.remove("open");
  window._importNuevas = null;
}

function confirmarImport(modo) {
  var nuevas = window._importNuevas || [];
  if (modo === "reemplazar") {
    reservas = nuevas;
  } else {
    reservas = reservas.concat(nuevas);
  }
  // Cerrar panel de opciones
  var t = document.getElementById("import-toast");
  if (t) t.remove();
  window._importNuevas = null;
  currentPage = 1;
  guardarReservas();
  renderTable();
  toast(nuevas.length + " reservas importadas correctamente", "success");
}


// ── REPRESENTANTES ───────────────────────────────────────────────────────────
function cargarRepresentantes() {
  try { var d = localStorage.getItem("karaoke_representantes"); if (d) return JSON.parse(d); } catch(e) {}
  return [];
}
function guardarRepresentantesLS() {
  try { localStorage.setItem("karaoke_representantes", JSON.stringify(representantes)); } catch(e) {}
}
var representantes = cargarRepresentantes();
var editingReprId = null;

function openRepresentantes() {
  editingReprId = null; limpiarFormRepr(); renderRepresentantes(); renderStatsRepresentantes();
  document.getElementById("modal-representantes").classList.add("open");
}
function closeRepresentantes() { document.getElementById("modal-representantes").classList.remove("open"); }
function limpiarFormRepr() {
  document.getElementById("r-liceo").value = "";
  document.getElementById("r-promocion").value = "";
  document.getElementById("r-nombre").value = "";
  document.getElementById("r-telefono").value = "";
  document.getElementById("r-email").value = "";
}
function cancelarEditarRepr() { editingReprId = null; limpiarFormRepr(); document.getElementById("repr-form-title").textContent = "Nuevo Representante"; }
function guardarRepresentante() {
  var liceo = document.getElementById("r-liceo").value.trim();
  var promocion = document.getElementById("r-promocion").value.trim();
  var nombre = document.getElementById("r-nombre").value.trim();
  var telefono = document.getElementById("r-telefono").value.trim();
  var email = document.getElementById("r-email").value.trim();
  if (!liceo) { toast("El Liceo es obligatorio", "error"); return; }
  if (!nombre) { toast("El Nombre es obligatorio", "error"); return; }
  if (editingReprId !== null) {
    var idx = representantes.findIndex(function(r){ return r.id === editingReprId; });
    if (idx !== -1) representantes[idx] = { id: editingReprId, liceo: liceo, promocion: promocion, nombre: nombre, telefono: telefono, email: email };
    toast("Representante actualizado", "success"); editingReprId = null;
  } else {
    var newId = representantes.length > 0 ? Math.max.apply(null, representantes.map(function(r){ return r.id; })) + 1 : 1;
    representantes.push({ id: newId, liceo: liceo, promocion: promocion, nombre: nombre, telefono: telefono, email: email });
    toast("Representante agregado", "success");
  }
  guardarRepresentantesLS(); limpiarFormRepr();
  document.getElementById("repr-form-title").textContent = "Nuevo Representante";
  actualizarFiltroRepresentantes(); renderRepresentantes(); renderStatsRepresentantes();
}
function editarRepresentante(id) {
  var r = representantes.find(function(x){ return x.id === id; });
  if (!r) return;
  editingReprId = id;
  document.getElementById("r-liceo").value = r.liceo || "";
  document.getElementById("r-promocion").value = r.promocion || "";
  document.getElementById("r-nombre").value = r.nombre || "";
  document.getElementById("r-telefono").value = r.telefono || "";
  document.getElementById("r-email").value = r.email || "";
  document.getElementById("repr-form-title").textContent = "Editar Representante";
}
function eliminarRepresentante(id) {
  var r = representantes.find(function(x){ return x.id === id; });
  if (!r) return;
  if (!confirm("¿Eliminar al representante " + r.nombre + "?")) return;
  representantes = representantes.filter(function(x){ return x.id !== id; });
  guardarRepresentantesLS(); actualizarFiltroRepresentantes(); renderRepresentantes(); renderStatsRepresentantes();
  toast("Representante eliminado", "info");
}
function renderRepresentantes() {
  var lista = document.getElementById("repr-lista");
  if (!lista) return;
  if (representantes.length === 0) { lista.innerHTML = '<div style="text-align:center;padding:20px;color:#9ca3af;font-size:.85rem">No hay representantes registrados</div>'; return; }
  var sorted = representantes.slice().sort(function(a,b){ return (a.nombre||"").localeCompare(b.nombre||""); });
  var html = '';
  for (var i=0; i<sorted.length; i++) {
    var r = sorted[i];
    var abrev = abreviarLiceo(r.liceo||"");
    html += '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;margin-bottom:6px">';
    html += '<div style="flex-shrink:0;width:36px;height:36px;border-radius:50%;background:rgba(0,35,102,.1);display:flex;align-items:center;justify-content:center;font-size:.65rem;font-weight:700;color:#002366">' + esc(abrev) + '</div>';
    html += '<div style="flex:1;min-width:0"><div style="font-weight:700;color:#111;font-size:.88rem">' + esc(r.nombre) + '</div>';
    html += '<div style="font-size:.72rem;color:#555;margin-top:1px">' + esc(r.liceo||"") + (r.promocion ? ' · Prom. ' + esc(r.promocion) : '') + '</div>';
    if (r.telefono || r.email) { html += '<div style="font-size:.7rem;color:#888;margin-top:2px">'; if (r.telefono) html += '&#128222; ' + esc(r.telefono); if (r.telefono && r.email) html += ' · '; if (r.email) html += '&#128140; ' + esc(r.email); html += '</div>'; }
    html += '</div>';
    html += '<div style="display:flex;gap:6px;flex-shrink:0">';
    html += '<button class="btn btn-success btn-sm" onclick="editarRepresentante(' + r.id + ')" style="color:#000">&#9999;&#65039; Editar</button>';
    html += '<button class="btn btn-danger btn-sm" onclick="eliminarRepresentante(' + r.id + ')" style="color:#000">&#128465; Eliminar</button>';
    html += '</div></div>';
  }
  lista.innerHTML = html;
}
function actualizarFiltroRepresentantes() {
  var sel = document.getElementById("filtro-representante");
  if (!sel) return;
  var current = sel.value;
  sel.innerHTML = '<option value="">&#128100; Todos los representantes</option>';
  var sorted = representantes.slice().sort(function(a,b){ return (a.nombre||"").localeCompare(b.nombre||""); });
  for (var i=0; i<sorted.length; i++) {
    var r = sorted[i];
    var opt = document.createElement("option");
    opt.value = r.id;
    opt.textContent = r.nombre + (r.liceo ? " (" + abreviarLiceo(r.liceo) + " " + (r.promocion||"") + ")" : "");
    sel.appendChild(opt);
  }
  if (current) sel.value = current;
}
function getRepresentante(liceo, promocion) {
  if (!liceo && !promocion) return null;
  return representantes.find(function(r) {
    var ml = !liceo || !r.liceo || r.liceo.trim().toLowerCase() === liceo.trim().toLowerCase();
    var mp = !promocion || String(r.promocion||"").trim() === String(promocion||"").trim();
    return ml && mp;
  }) || null;
}
function calcStatsRepresentante(repr) {
  var st = {reservas:0,asistentes:0,presentes:0,abonados:0,canceladas:0};
  for (var i=0; i<reservas.length; i++) {
    var r = reservas[i];
    var ml = !repr.liceo||!r.liceo||r.liceo.trim().toLowerCase()===repr.liceo.trim().toLowerCase();
    var mp = !repr.promocion||String(r.nroPromocion||"").trim()===String(repr.promocion||"").trim();
    if (!ml||!mp) continue;
    st.reservas++;
    if (r.cancelada){st.canceladas++;continue;}
    var amA=r.amigos?r.amigos.split(",").map(function(a){return a.trim();}).filter(Boolean):[];
    var tot=amA.length+1; st.asistentes+=tot;
    for (var k=0;k<tot;k++){if(r.estados&&r.estados["p"+k]==="presente")st.presentes++;if(r.abonos&&r.abonos["p"+k]==="abono")st.abonados++;}
  }
  return st;
}
function renderStatsRepresentantes() {
  var el = document.getElementById("repr-stats");
  if (!el) return;
  if (representantes.length === 0) { el.innerHTML = ""; return; }
  var statsData = representantes.map(function(r){ return {repr:r, stats:calcStatsRepresentante(r)}; }).sort(function(a,b){ return b.stats.asistentes-a.stats.asistentes; });
  var html = '<div style="margin-top:14px;border-top:1px solid #e5e7eb;padding-top:12px"><div style="font-size:.75rem;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">&#128202; Estadísticas por Representante</div>';
  for (var i=0; i<statsData.length; i++) {
    var d=statsData[i]; var r=d.repr; var s=d.stats;
    var pct=s.asistentes>0?Math.round(s.presentes/s.asistentes*100):0;
    var aboPct=s.asistentes>0?Math.round(s.abonados/s.asistentes*100):0;
    var rankLabel=i===0?"&#127941;":i===1?"&#129352;":i===2?"&#129353;":"#"+(i+1);
    html+='<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px;margin-bottom:8px">';
    html+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span style="font-size:.9rem;min-width:24px">'+rankLabel+'</span>';
    html+='<div style="flex:1"><div style="font-weight:700;color:#111;font-size:.88rem">'+esc(r.nombre)+'</div>';
    html+='<div style="font-size:.7rem;color:#555">'+esc(r.liceo||"")+(r.promocion?" · Prom. "+esc(r.promocion):"")+'</div></div>';
    html+='<div style="display:flex;gap:8px">';
    html+='<div style="text-align:center"><div style="font-size:1rem;font-weight:800;color:#002366">'+s.reservas+'</div><div style="font-size:.6rem;color:#888">Reservas</div></div>';
    html+='<div style="text-align:center"><div style="font-size:1rem;font-weight:800;color:#0891b2">'+s.asistentes+'</div><div style="font-size:.6rem;color:#888">Asistentes</div></div>';
    html+='<div style="text-align:center"><div style="font-size:1rem;font-weight:800;color:#16a34a">'+s.presentes+'</div><div style="font-size:.6rem;color:#888">Presentes</div></div>';
    html+='<div style="text-align:center"><div style="font-size:1rem;font-weight:800;color:#f59e0b">'+s.abonados+'</div><div style="font-size:.6rem;color:#888">Abonados</div></div>';
    html+='</div></div>';
    if (s.asistentes>0) {
      html+='<div style="display:flex;gap:6px;align-items:center"><div style="flex:1;background:#e5e7eb;border-radius:4px;height:6px;overflow:hidden"><div style="width:'+pct+'%;background:#16a34a;height:100%;border-radius:4px"></div></div>';
      html+='<span style="font-size:.65rem;color:#555;min-width:60px">'+pct+'% presentes</span>';
      html+='<div style="flex:1;background:#e5e7eb;border-radius:4px;height:6px;overflow:hidden"><div style="width:'+aboPct+'%;background:#f59e0b;height:100%;border-radius:4px"></div></div>';
      html+='<span style="font-size:.65rem;color:#555;min-width:60px">'+aboPct+'% abonados</span></div>';
    }
    html+='</div>';
  }
  html+='</div>';
  el.innerHTML = html;
}

// ── EVENTOS ───────────────────────────────────────────────────────────────────
document.getElementById("btn-import").addEventListener("click", function(){ document.getElementById("imp").click(); });
document.getElementById("imp").addEventListener("change", function(e){ importExcel(e); });
document.addEventListener("keydown", function(e) {
  if (e.key === "Escape") { closeModal(); closeConfirm(); closeDetail(); }
});

// ── EVENTO FECHA/HORA ────────────────────────────────────────────────────────
function cargarEvento() {
  try {
    var ev = localStorage.getItem("karaoke_evento");
    if (ev) {
      var obj = JSON.parse(ev);
      if (obj.fecha) document.getElementById("evento-fecha").value = obj.fecha;
      if (obj.hora) document.getElementById("evento-hora").value = obj.hora;
    }
  } catch(e) {}
}

function guardarEvento() {
  var fecha = document.getElementById("evento-fecha").value;
  var hora = document.getElementById("evento-hora").value;
  try { localStorage.setItem("karaoke_evento", JSON.stringify({fecha:fecha, hora:hora})); } catch(e) {}
}

document.getElementById("evento-fecha").addEventListener("change", guardarEvento);
document.getElementById("evento-hora").addEventListener("change", guardarEvento);

// ── INIT ──────────────────────────────────────────────────────────────────────
cargarEvento();
renderTable();
