
const loginPanel = document.querySelector('#login-panel');
const settingsPanel = document.querySelector('#settings-panel');

let csrfToken = '';

const fields = ['rain', 'soil', 'stream', 'slope'];

async function request(url, options = {}) {
  const response = await fetch(url, {
    cache: 'no-store',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

function showMessage(id, message, success = false) {
  const element = document.querySelector(id);

  element.textContent = message;
  element.className = success ? 'message success' : 'message';
}

async function checkLogin() {
  try {
    const data = await request('/api/admin/me');

    if (data.authenticated) {
      csrfToken = data.csrf;
      showSettings(data.weights);
    }
  } catch (error) {
    console.log('Not logged in');
  }
}

function showSettings(weights) {
  loginPanel.hidden = true;
  settingsPanel.hidden = false;

  fields.forEach(key => {
    document.querySelector('#' + key).value = weights[key];
  });

  updateTotal();
}

document.querySelector('#login-form').addEventListener(
  'submit',
  async event => {
    event.preventDefault();

    const password = document.querySelector('#password').value;

    try {
      const data = await request('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ password })
      });

      csrfToken = data.csrf;

      const me = await request('/api/admin/me');

      showSettings(me.weights);

      document.querySelector('#password').value = '';

      showMessage('#login-message', '', true);

    } catch (error) {
      showMessage('#login-message', error.message);
    }
  }
);

function getWeights() {
  return Object.fromEntries(
    fields.map(key => [
      key,
      Number(document.querySelector('#' + key).value)
    ])
  );
}

function updateTotal() {
  const total = fields.reduce((sum, key) => {
    return sum + Number(document.querySelector('#' + key).value || 0);
  }, 0);

  const element = document.querySelector('#total');

  element.textContent = total + '%';
  element.className =
    total === 100 ? 'valid' : 'invalid';

  return total;
}

fields.forEach(key => {
  document.querySelector('#' + key).addEventListener(
    'input',
    updateTotal
  );
});

document.querySelector('#weights-form').addEventListener(
  'submit',
  async event => {
    event.preventDefault();

    const weights = getWeights();

    if (
      fields.some(key =>
        !Number.isInteger(weights[key]) ||
        weights[key] < 0 ||
        weights[key] > 100
      )
    ) {
      showMessage(
        '#settings-message',
        'Enter whole numbers between 0 and 100.'
      );
      return;
    }

    if (updateTotal() !== 100) {
      showMessage(
        '#settings-message',
        'The four weights must total exactly 100%.'
      );
      return;
    }

    const button = document.querySelector('#save-button');
    button.disabled = true;
    button.textContent = 'Saving...';

    try {
      const result = await request('/api/admin/settings', {
        method: 'POST',
        headers: {
          'X-CSRF-Token': csrfToken
        },
        body: JSON.stringify({
          weights,
          csrf: csrfToken
        })
      });

      showSettings(result.weights);

      showMessage(
        '#settings-message',
        'Risk settings successfully updated.',
        true
      );

    } catch (error) {
      showMessage('#settings-message', error.message);
    } finally {
      button.disabled = false;
      button.textContent = 'Save risk settings';
    }
  }
);

document.querySelector('#logout').addEventListener(
  'click',
  async () => {
    try {
      await request('/api/admin/logout', {
        method: 'POST',
        body: JSON.stringify({ csrf: csrfToken })
      });
    } catch (error) {
      console.error(error);
    }

    csrfToken = '';

    settingsPanel.hidden = true;
    loginPanel.hidden = false;

    showMessage('#login-message', 'You have been logged out.', true);
  }
);

checkLogin();
