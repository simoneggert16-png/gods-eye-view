import test from 'node:test';
import assert from 'node:assert/strict';
import { personWebSearch } from './person-web.js';

const KEY = process.env.TAVILY_API_KEY;
process.env.TAVILY_API_KEY = 'test-key';

function tavilyReply(handlers) {
  return async (url, options) => {
    if (!String(url).includes('api.tavily.com')) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    const query = JSON.parse(options.body).query;
    const results = handlers(query) || [];
    return {
      ok: true,
      status: 200,
      json: async () => ({ results }),
    };
  };
}

test.after(() => {
  if (KEY === undefined) delete process.env.TAVILY_API_KEY;
  else process.env.TAVILY_API_KEY = KEY;
});

test('a published practice address in a snippet becomes a map candidate', async () => {
  const body = await personWebSearch({
    name: 'Sibylle Baumgartner-Büchel',
    place: 'Rüthi',
    fetchImpl: tavilyReply((query) => {
      if (query.includes('Impressum')) return [];
      return [
        {
          title: 'Sibylle Baumgartner-Büchel in Rüthi (Rheintal) | prendre rendez-vous',
          url: 'https://emr.ch/therapeute/sibyllebuechel',
          content:
            'Untere Färschstrasse 14, 9464 Rüthi. Naturheilpraktikerin mit eidg. Diplom, 071 123 45 67.',
        },
      ];
    }),
  });
  assert.equal(body.results.length, 1);
  assert.equal(body.results[0].address, 'Untere Färschstrasse 14, 9464 Rüthi');
  assert.equal(body.results[0].phone, '071 123 45 67');
});

test('the Impressum pass adds the address the first query only linked', async () => {
  const body = await personWebSearch({
    name: 'David Murdoch',
    place: 'Graubünden',
    fetchImpl: tavilyReply((query) => {
      if (!query.includes('Impressum'))
        return [
          {
            title: 'David Murdoch',
            url: 'https://ch.linkedin.com/in/david-murdoch',
            content: 'Profil von David Murdoch in LinkedIn.',
          },
        ];
      return [
        {
          title: 'David James Murdoch Firn Studio • Jenaz • Graubünden',
          url: 'https://www.better-search.ch/de/detail/david-james-murdoch-firn-studio',
          content: 'Eintrag in Adressbuch.',
          raw_content:
            '## David James Murdoch Firn Studio ### Kontaktinformationen Platz 8 7233 Jenaz Kanton: Graubünden CH Telefon (081) 558 82 82 E-Mail: david@firnstudio.ch',
        },
      ];
    }),
  });
  const detail = body.results.find((row) => row.url.includes('better-search'));
  assert.equal(detail.address, 'Platz 8, 7233 Jenaz');
  assert.equal(detail.phone, '(081) 558 82 82');
  assert.equal(detail.email, 'david@firnstudio.ch');
  assert.equal(body.source, 'Tavily');
});

test('a directory header address stays out when the name is far away', async () => {
  const body = await personWebSearch({
    name: 'Nina Okafor',
    place: 'Bern',
    fetchImpl: tavilyReply((query) => {
      if (query.includes('Impressum')) return [];
      return [
        {
          title: 'Branchenverzeichnis Bern',
          url: 'https://verzeichnis.example/ch/nina-okafor',
          content:
            `Herausgeber: Branchenverzeichnis AG, Bubenbergplatz 7, 3007 Bern. ` +
            `Dieses Verzeichnis listet Unternehmen, Vereine und öffentliche Einrichtungen ` +
            `und wird laufend aktualisiert; Einträge können jederzeit geändert werden. ` +
            `Es gelten unsere Nutzungsbedingungen und der Hinweis auf das Schweizer ` +
            `Datenschutzgesetz, kurz DSG. Kontakt über das Formular. ` +
            `Ihre Suche nach Ergebnissen liefert: Nina Okafor, Architektur, gefunden.`,
        },
      ];
    }),
  });
  assert.equal(body.results.length, 1);
  assert.equal(body.results[0].address, undefined);
});

test('full-name and place matches with contact details outrank partial surname hits', async () => {
  const body = await personWebSearch({
    name: 'Lukas Keller',
    place: 'Zürich',
    fetchImpl: tavilyReply((query) => {
      if (query.includes('Impressum')) return [];
      return [
        {
          title: 'Keller AG Bauunternehmung',
          url: 'https://keller-bau.example/team',
          content: 'Unser Team in Basel: Martin Keller, Projektleiter.',
        },
        {
          title: 'Lukas Keller — Rechtsanwalt in Zürich',
          url: 'https://kanzlei-keller.example/lukas-keller',
          content: 'Lukas Keller, Limmatquai 42, 8001 Zürich. Tel. +41 44 211 33 44.',
        },
      ];
    }),
  });
  assert.equal(body.results.length, 2);
  assert.equal(body.results[0].url, 'https://kanzlei-keller.example/lukas-keller');
  assert.equal(body.results[0].address, 'Limmatquai 42, 8001 Zürich');
  assert.equal(body.results[0].phone, '+41 44 211 33 44');
});

test('deep research extracts umlaut names, raw_content contacts, and deobfuscated emails', async () => {
  const body = await personWebSearch({
    name: 'Jürg Müller',
    place: 'Zürich',
    fetchImpl: tavilyReply((query) => {
      if (query.includes('Kontakt')) {
        return [
          {
            title: 'Unser Team | Treuhand Zürich',
            url: 'https://treuhand-zh.example/team',
            content: 'Willkommen bei unserer Treuhandgesellschaft in Zürich.',
            raw_content:
              'Navigation Startseite Über uns Mandate Kontakt. ' +
              'Partner: Jürg Müller, dipl. Wirtschaftsprüfer, Bahnhofstrasse 10, 8001 Zürich. ' +
              'Telefon: +41 (0)44 321 65 43, Mobil: 079 876 54 32, E-Mail: juerg.mueller [at] treuhand-zh.ch',
          },
        ];
      }
      return [];
    }),
  });
  assert.equal(body.results.length, 1);
  const hit = body.results[0];
  assert.equal(hit.address, 'Bahnhofstrasse 10, 8001 Zürich');
  assert.equal(hit.phone, '+41 (0)44 321 65 43');
  assert.deepEqual(hit.phones, ['+41 (0)44 321 65 43', '079 876 54 32']);
  assert.equal(hit.email, 'juerg.mueller@treuhand-zh.ch');
  assert.match(hit.snippet, /Jürg Müller/);
  assert.equal(body.contacts.phones.length, 2);
  assert.equal(body.contacts.emails[0].email, 'juerg.mueller@treuhand-zh.ch');
});

test('multi-word Swiss street names like St. Gallerstrasse and Im Wingert stay intact', async () => {
  const body = await personWebSearch({
    name: 'Thomas Frei',
    place: 'Heerbrugg',
    fetchImpl: tavilyReply((query) => {
      if (query.includes('Impressum') || query.includes('Kontakt')) return [];
      return [
        {
          title: 'Thomas Frei — Architektur Heerbrugg',
          url: 'https://frei-architektur.example/kontakt',
          content:
            'Büro Thomas Frei, St. Gallerstrasse 12, 9435 Heerbrugg, Tel. 071 722 11 22.',
        },
        {
          title: 'Thomas Frei Privatadresse',
          url: 'https://verzeichnis.example/thomas-frei',
          content:
            'Eintrag: Thomas Frei, wohnhaft Im Wingert 4, 9435 Heerbrugg.',
        },
      ];
    }),
  });
  assert.equal(body.results.length, 2);
  assert.equal(body.results[0].address, 'St. Gallerstrasse 12, 9435 Heerbrugg');
  assert.equal(body.results[1].address, 'Im Wingert 4, 9435 Heerbrugg');
});
