// Texts the scripts write into the page, per language (the HTML itself comes from locales.mjs).

const base = (document.documentElement.lang || 'en').toLowerCase().split('-')[0]
export const LANG = ['en', 'pt', 'es'].includes(base) ? base : 'en'

const LOCALE = { en: 'en-US', pt: 'pt-BR', es: 'es-ES' }

const STRINGS = {
  en: {
    checking: 'checking…',
    always: 'always on',
    optional: 'optional',
    features: [
      ['Network', 'Ad and tracker blocking', "uBlock Origin's lists, refreshed every day.", 1],
      ['Network', 'HTTPS everywhere', 'Connections without a padlock are upgraded to HTTPS, or you get a warning.', 1],
      ['Network', 'Encrypted DNS', 'Cloudflare, Quad9 or Google, in the versions that already filter malware.', 1],
      ['Network', 'TLS 1.2 or newer', 'Old, weak encryption is refused.', 1],
      ['Network', 'Local network shield', "Sites can't reach your router or the apps on your PC.", 1],
      ['Network', 'WebRTC without IP leaks', "Video calls don't expose your internal addresses.", 1],
      ['Privacy', 'Clean links', 'fbclid, gclid and utm_ removed before the page opens.', 1],
      ['Privacy', 'Fingerprint protection', "Your browser looks like everyone else's.", 1],
      ['Privacy', 'Bounce tracking', 'Cookies from sites that only bounce you through are wiped.', 1],
      ['Privacy', 'JavaScript per site', 'Turn scripts off on one site, or on all of them by default.', 0],
      ['Privacy', 'Pop-ups and notifications', 'Only after you click something.', 1],
      ['Scams', 'Look-alike sites', 'Swapped letters, fake alphabets or brands used as bait.', 1],
      ['Scams', 'Phishing and malware lists', 'Refreshed every 12 hours, checked on your PC.', 1],
      ['Scams', 'Leaked passwords', 'Warns you if a password you typed has shown up in a breach.', 1],
      ['Scams', 'Anti-“ClickFix”', 'Clears commands a site tries to slip into your clipboard.', 1],
      ['Scams', 'Fake full screen', 'Shows the real site when a page pretends to be Windows.', 1],
      ['Downloads', 'Program confirmation', 'Executables and scripts wait for your yes.', 1],
      ['Downloads', 'Microsoft Defender', 'Programs and archives are scanned when they finish.', 1],
      ['Downloads', 'Zip x-ray', 'Flags hidden programs and password-locked archives.', 1],
      ['Downloads', 'Disguised names', '“invoice.pdf.exe” and reversed text are caught.', 1],
      ['Downloads', 'Refuse executables', 'Blocks .exe, .msi, .bat and .ps1 without asking.', 0],
      ['System', 'Windows security panel', 'Antivirus, firewall, Secure Boot, memory integrity and more.', 1],
      ['System', 'Anti-mining', 'Tabs that hijack your processor are put to sleep.', 1],
      ['System', 'Automatic updates', 'Security fixes arrive on their own.', 1],
      ['System', 'Hardened executable', "Halyard.exe can't be used to run someone else's code.", 1],
      ['AI', 'Local assistant', 'Runs on your computer, no cloud.', 0],
      ['AI', 'QR Codes and links', 'Shows where a link goes before you open it.', 1]
    ],
    licensesTitle: 'Open-source licenses',
    licensesIntro: "Halyard is free software (MIT license) built on the work of many people. These {n} components ship with it or are downloaded by it, each under its own license. The full texts are in <code>THIRD_PARTY_NOTICES.txt</code>, in the program's folder.",
    licensesSearch: 'Search by name or license',
    component: 'Component',
    license: 'License'
  },
  pt: {
    checking: 'verificando…',
    always: 'sempre ligado',
    optional: 'opcional',
    features: [
      ['Rede', 'Bloqueio de anúncios e rastreadores', 'Listas do uBlock Origin, atualizadas todo dia.', 1],
      ['Rede', 'HTTPS em tudo', 'Conexões sem cadeado são promovidas para HTTPS, ou você é avisado.', 1],
      ['Rede', 'DNS criptografado', 'Cloudflare, Quad9 ou Google, nas versões que já filtram malware.', 1],
      ['Rede', 'TLS 1.2 ou mais novo', 'Criptografia fraca e antiga é recusada.', 1],
      ['Rede', 'Rede local protegida', 'Sites não alcançam o roteador nem programas do PC.', 1],
      ['Rede', 'WebRTC sem vazar IP', 'Chamadas de vídeo não expõem seus endereços internos.', 1],
      ['Privacidade', 'Links limpos', 'fbclid, gclid e utm_ removidos antes de abrir.', 1],
      ['Privacidade', 'Proteção contra impressão digital', 'Seu navegador fica parecido com todos os outros.', 1],
      ['Privacidade', 'Rastreio por redirecionamento', 'Cookies de sites que só “quicam” você são apagados.', 1],
      ['Privacidade', 'JavaScript por site', 'Desligue scripts num site, ou em todos por padrão.', 0],
      ['Privacidade', 'Pop-ups e notificações', 'Só depois de um clique seu.', 1],
      ['Golpes', 'Sites parecidos', 'Letra trocada, alfabeto falso ou marca de isca.', 1],
      ['Golpes', 'Listas de phishing e malware', 'Atualizadas a cada 12 horas, checadas no seu PC.', 1],
      ['Golpes', 'Senha vazada', 'Avisa se a senha digitada já apareceu num vazamento.', 1],
      ['Golpes', 'Anti-“ClickFix”', 'Limpa comandos que um site tenta jogar na sua área de transferência.', 1],
      ['Golpes', 'Tela cheia falsa', 'Mostra o site real quando uma página imita o Windows.', 1],
      ['Downloads', 'Confirmação de programas', 'Executáveis e scripts esperam o seu sim.', 1],
      ['Downloads', 'Microsoft Defender', 'Programas e compactados são escaneados ao terminar.', 1],
      ['Downloads', 'Raio-x do .zip', 'Avisa sobre programas escondidos ou .zip com senha.', 1],
      ['Downloads', 'Nomes disfarçados', '“fatura.pdf.exe” e texto invertido são detectados.', 1],
      ['Downloads', 'Recusar executáveis', 'Bloqueia .exe, .msi, .bat e .ps1 sem perguntar.', 0],
      ['Sistema', 'Painel de segurança do Windows', 'Antivírus, firewall, Secure Boot, integridade da memória e mais.', 1],
      ['Sistema', 'Anti-mineração', 'Abas que sequestram o processador vão dormir.', 1],
      ['Sistema', 'Atualização automática', 'Correções de segurança chegam sozinhas.', 1],
      ['Sistema', 'Executável blindado', 'O Halyard.exe não pode ser usado para rodar código de terceiros.', 1],
      ['IA', 'Assistente local', 'Roda no seu computador, sem nuvem.', 0],
      ['IA', 'QR Code e links', 'Mostra para onde um link leva antes de abrir.', 1]
    ],
    licensesTitle: 'Licenças de código aberto',
    licensesIntro: 'O Halyard é software livre (licença MIT) feito sobre o trabalho de muita gente. Estes {n} componentes vêm junto com ele ou são baixados por ele, cada um com a própria licença. Os textos completos ficam em <code>THIRD_PARTY_NOTICES.txt</code>, na pasta do programa.',
    licensesSearch: 'Buscar por nome ou licença',
    component: 'Componente',
    license: 'Licença'
  },
  es: {
    checking: 'comprobando…',
    always: 'siempre activo',
    optional: 'opcional',
    features: [
      ['Red', 'Bloqueo de anuncios y rastreadores', 'Las listas de uBlock Origin, actualizadas cada día.', 1],
      ['Red', 'HTTPS en todo', 'Las conexiones sin candado pasan a HTTPS, o recibes un aviso.', 1],
      ['Red', 'DNS cifrado', 'Cloudflare, Quad9 o Google, en sus versiones que ya filtran malware.', 1],
      ['Red', 'TLS 1.2 o más reciente', 'Se rechaza el cifrado viejo y débil.', 1],
      ['Red', 'Red local protegida', 'Los sitios no llegan a tu router ni a las apps de tu PC.', 1],
      ['Red', 'WebRTC sin fugas de IP', 'Las videollamadas no exponen tus direcciones internas.', 1],
      ['Privacidad', 'Enlaces limpios', 'fbclid, gclid y utm_ se eliminan antes de abrir la página.', 1],
      ['Privacidad', 'Protección contra huella digital', 'Tu navegador se parece a todos los demás.', 1],
      ['Privacidad', 'Rastreo por redirección', 'Se borran las cookies de sitios que solo te hacen rebotar.', 1],
      ['Privacidad', 'JavaScript por sitio', 'Desactiva los scripts en un sitio, o en todos por defecto.', 0],
      ['Privacidad', 'Ventanas emergentes y notificaciones', 'Solo después de que hagas clic.', 1],
      ['Estafas', 'Sitios parecidos', 'Letras cambiadas, alfabetos falsos o marcas usadas como cebo.', 1],
      ['Estafas', 'Listas de phishing y malware', 'Actualizadas cada 12 horas, comprobadas en tu PC.', 1],
      ['Estafas', 'Contraseñas filtradas', 'Te avisa si una contraseña que escribiste apareció en una filtración.', 1],
      ['Estafas', 'Anti-“ClickFix”', 'Limpia los comandos que un sitio intenta colar en tu portapapeles.', 1],
      ['Estafas', 'Pantalla completa falsa', 'Muestra el sitio real cuando una página imita a Windows.', 1],
      ['Descargas', 'Confirmación de programas', 'Los ejecutables y scripts esperan tu sí.', 1],
      ['Descargas', 'Microsoft Defender', 'Los programas y archivos comprimidos se analizan al terminar.', 1],
      ['Descargas', 'Rayos X del .zip', 'Avisa de programas escondidos y .zip con contraseña.', 1],
      ['Descargas', 'Nombres disfrazados', 'Detecta “factura.pdf.exe” y el texto invertido.', 1],
      ['Descargas', 'Rechazar ejecutables', 'Bloquea .exe, .msi, .bat y .ps1 sin preguntar.', 0],
      ['Sistema', 'Panel de seguridad de Windows', 'Antivirus, firewall, Secure Boot, integridad de memoria y más.', 1],
      ['Sistema', 'Anti-minería', 'Las pestañas que secuestran el procesador se duermen.', 1],
      ['Sistema', 'Actualizaciones automáticas', 'Los parches de seguridad llegan solos.', 1],
      ['Sistema', 'Ejecutable blindado', 'Halyard.exe no puede usarse para ejecutar código ajeno.', 1],
      ['IA', 'Asistente local', 'Se ejecuta en tu ordenador, sin nube.', 0],
      ['IA', 'Códigos QR y enlaces', 'Muestra adónde lleva un enlace antes de abrirlo.', 1]
    ],
    licensesTitle: 'Licencias de código abierto',
    licensesIntro: 'Halyard es software libre (licencia MIT) construido sobre el trabajo de mucha gente. Estos {n} componentes vienen con él o los descarga, cada uno con su propia licencia. Los textos completos están en <code>THIRD_PARTY_NOTICES.txt</code>, en la carpeta del programa.',
    licensesSearch: 'Buscar por nombre o licencia',
    component: 'Componente',
    license: 'Licencia'
  }
}

export const S = STRINGS[LANG]
export const LOCALE_TAG = LOCALE[LANG]

/** Remember the language the user picked, so the root page sends them back to it. */
export function rememberLanguageChoice() {
  for (const a of document.querySelectorAll('[data-lang]'))
    a.addEventListener('click', () => {
      try {
        localStorage.setItem('halyard-lang', a.dataset.lang)
      } catch {
        /* private mode: the browser language is used next time */
      }
      // the cookie lets the server redirect "/" straight to this language
      try {
        document.cookie = `halyard-lang=${a.dataset.lang}; path=/; max-age=31536000; samesite=lax`
      } catch {
        /* private mode: the browser language is used next time */
      }
    })
}
