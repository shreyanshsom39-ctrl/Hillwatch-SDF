
const select = document.querySelector('#district');

const pins = new Map();
let map;

const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

async function api(url) {
  const response = await fetch(url, {
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`Server returned ${response.status}`);
  }

  return response.json();
}

async function start() {
  try {
    if (!window.L) {
      throw new Error('Map library unavailable');
    }

    map = L.map('map').setView([31.75, 77.2], 7);

    L.tileLayer('https://tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17,
      attribution:
        '&copy; OpenStreetMap contributors / SRTM | ' +
        '&copy; OpenTopoMap'
    }).addTo(map);

    const places = await api('/api/districts');

    if (!Array.isArray(places) || places.length === 0) {
      throw new Error('No district information available');
    }

    places.forEach(place => {
      const option = document.createElement('option');

      option.value = place.id;
      option.textContent = place.name;

      select.appendChild(option);

      const pin = L.circleMarker(
        [place.lat, place.lon],
        {
          radius: 7,
          color: '#ffffff',
          weight: 2,
          fillColor: '#718da3',
          fillOpacity: 1
        }
      ).addTo(map);

      pin.bindPopup(
        `<b>${safe(place.name)}</b><br>Approximate demo location`
      );

      pin.on('click', () => {
        select.value = place.id;
        focus(place);
        update();
      });

      pins.set(place.id, pin);
    });

    select.addEventListener('change', () => {
      const place = places.find(p => p.id === select.value);

      if (place) {
        focus(place);
        update();
      }
    });

    select.value = places[0].id;

    focus(places[0]);

    await update();

    document.querySelector('#connection').textContent =
      'SIMULATED · ONLINE';

    setInterval(update, REFRESH_INTERVAL_MS);

  } catch (error) {
    console.error(error);

    document.querySelector('#connection').textContent =
      'CONNECTION ERROR';
  }
}

function focus(place) {
  map.flyTo([place.lat, place.lon], 10, {
    duration: 1
  });

  pins.get(place.id)?.openPopup();
}

async function update() {
  if (!select.value) return;

  try {
    const d = await api(
      `/api/live?district=${encodeURIComponent(select.value)}`
    );

    document.querySelector('#place-name').textContent = d.name;

    document.querySelector('#region').textContent =
      d.region + ' · approximate district point';

    document.querySelector('#score').textContent = d.score;

    const level = document.querySelector('#level');

    level.textContent = d.level.toUpperCase() + ' DEMO';
    level.className = d.level.toLowerCase();

    document.querySelector('#rain').textContent = d.rain;
    document.querySelector('#soil').textContent = d.soil;
    document.querySelector('#stream').textContent = d.stream;
    document.querySelector('#slope').textContent = d.slope;

    bar('rain-bar', d.rain / 150 * 100);
    bar('soil-bar', d.soil);
    bar('stream-bar', d.stream / 5 * 100);
    bar('slope-bar', d.slope / 90 * 100);

    document.querySelector('#updated').textContent =
      new Date(d.updatedAt).toLocaleTimeString();

    pins.forEach((pin, id) => {
      const selected = id === d.id;

      pin.setStyle({
        radius: selected ? 11 : 7,
        fillColor: selected ? riskColor(d.level) : '#718da3'
      });
    });

    document.querySelector('#connection').textContent =
      'SIMULATED · ONLINE';

  } catch (error) {
    console.error('Reading error:', error);

    document.querySelector('#connection').textContent =
      'SERVER ERROR';
  }
}

function bar(id, percentage) {
  document.querySelector(`#${id}`).style.width =
    Math.max(0, Math.min(100, Number(percentage))) + '%';
}

function riskColor(level) {
  if (level === 'High') return '#c7473e';
  if (level === 'Moderate') return '#dc9228';
  return '#38854b';
}

function safe(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

start();
