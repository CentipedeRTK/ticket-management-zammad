// --- Config défaut (zoom large, position initiale) ---
const DEFAULT_LAT = 45.999971435;
const DEFAULT_LNG = -1.213860512;
const DEFAULT_ZOOM = 12; // zoom large

async function loadCountries() {
  const sel = document.getElementById('country');
  sel.innerHTML = '<option value="">Chargement…</option>';
  try {
    const res = await fetch('/api/countries');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const list = await res.json();
    sel.innerHTML = '<option value="">Sélectionner…</option>' +
      list.map(c => `<option value="${c.code}">${c.name} (${c.code})</option>`).join('');
  } catch (e) {
    sel.innerHTML = '<option value="">Erreur de chargement</option>';
    console.error('countries error:', e);
  }
}

let map, marker;
function initMap() {
  const latEl = document.getElementById('lat');
  const lngEl = document.getElementById('lng');

  // Carte centrée par défaut (zoom large)
  map = L.map('map', { zoomControl: true }).setView([DEFAULT_LAT, DEFAULT_LNG], DEFAULT_ZOOM);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  // Marqueur non draggable (mise à jour par champs UNIQUEMENT)
  marker = L.marker([DEFAULT_LAT, DEFAULT_LNG], { draggable: false }).addTo(map);

  // Pas de map.on('click', on ne remplit pas depuis la carte
  // Synchronisation unidirectionnelle: champs -> carte
  function syncFromInputs() {
    const lat = parseFloat(latEl.value);
    const lng = parseFloat(lngEl.value);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      marker.setLatLng([lat, lng]);
      // zoom doux sans forcer le zoom proche
      map.panTo([lat, lng], { animate: true, duration: 0.3 });
    }
  }
  latEl.addEventListener('input', syncFromInputs);
  lngEl.addEventListener('input', syncFromInputs);
}

function hookFiles() {
  const p1 = document.querySelector('input[name="photo1"]');
  const p2 = document.querySelector('input[name="photo2"]');
  const counter = document.getElementById('photos-count');
  if (!counter) return;

  function refreshCount() {
    const n = (p1?.files?.length || 0) + (p2?.files?.length || 0);
    counter.textContent = n ? `${n} photo(s) sélectionnée(s)` : '';
  }
  p1 && p1.addEventListener('change', refreshCount);
  p2 && p2.addEventListener('change', refreshCount);
  refreshCount();
}

// Validation 8 décimales mini sur lat/lng
function hasMin8Decimals(v) {
  return /^-?\d+\.\d{8,}$/.test(String(v).trim());
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadCountries();
  initMap();
  hookFiles();

  const form = document.getElementById('gnss-form');
  const result = document.getElementById('result');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    result.textContent = 'Soumission en cours…';

    // Contraintes explicites
    const latEl = document.getElementById('lat');
    const lngEl = document.getElementById('lng');
    const en = parseFloat(form.elements['e_n'].value);
    const ee = parseFloat(form.elements['e_e'].value);
    const eh = parseFloat(form.elements['e_h'].value);

    if (!hasMin8Decimals(latEl.value)) {
      result.textContent = '❌ Latitude invalide (au moins 8 décimales).';
      latEl.focus(); return;
    }
    if (!hasMin8Decimals(lngEl.value)) {
      result.textContent = '❌ Longitude invalide (au moins 8 décimales).';
      lngEl.focus(); return;
    }
    if (!(en <= 10)) { result.textContent = '❌ E_N doit être ≤ 10 mm.'; form.elements['e_n'].focus(); return; }
    if (!(ee <= 10)) { result.textContent = '❌ E_E doit être ≤ 10 mm.'; form.elements['e_e'].focus(); return; }
    if (!(eh <= 20)) { result.textContent = '❌ E_H doit être ≤ 20 mm.'; form.elements['e_h'].focus(); return; }
    if (!document.getElementById('confirm_map').checked) {
      result.textContent = '❌ Veuillez confirmer la position sur la carte.'; return;
    }

    const fd = new FormData(form);
    try {
      const resp = await fetch('/api/submit', { method: 'POST', body: fd });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.detail?.message || JSON.stringify(data));
      // ===== BEGIN REPLACE: success message with email_status =====
      let emailInfo = 'Un email de confirmation va vous être envoyé.';

      if (data.email_status === 'sent') {
        emailInfo = 'Un email de confirmation vient d’être envoyé.';
      } else if (data.email_status === 'pending') {
        emailInfo = "L’email de confirmation est en cours d’envoi. Si vous ne le recevez pas sous quelques minutes, vérifiez vos indésirables.";
      } else if (data.email_status === 'failed') {
        emailInfo = "Ticket créé, mais l’email de confirmation n’a pas pu être envoyé. Veuillez vérifier vos indésirables ou réessayer plus tard.";
      }

      result.textContent = `✅ Ticket #${data.number} (id ${data.ticket_id}) créé. ${emailInfo}`;
      // ===== END REPLACE: success message with email_status =====

      form.reset();
      document.getElementById('country').value = '';
      const counter = document.getElementById('photos-count');
      if (counter) counter.textContent = '';
      // Remettre la carte sur la position/zoom par défaut
      map.setView([DEFAULT_LAT, DEFAULT_LNG], DEFAULT_ZOOM);
      marker.setLatLng([DEFAULT_LAT, DEFAULT_LNG]);
    } catch (err) {
      result.textContent = '❌ ' + (err.message || err);
    }
  });
});

