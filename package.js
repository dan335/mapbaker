Package.describe({
  name: 'danimal:mapbaker',
  summary: 'Map baker for Dominus http://dominusgame.net',
  version: '1.0.0',
  git: 'https://github.com/dan335/mapbaker'
});

Package.onUse(function(api) {
  api.versionsFrom('1.0.2.1');
  api.use('classcraft:knox@0.9.11')
  api.use('danimal:hx@1.0.6')
  api.addFiles('mapbaker.js');
  api.export('Mapbaker', 'server')
});

Npm.depends({
    svg2png: '1.1.0'
})