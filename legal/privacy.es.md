# Política de privacidad de Halyard Browser

**Última actualización:** 7 de noviembre de 2026

Esta política explica qué datos trata Halyard Browser ("Halyard", "nosotros"), por qué y cuáles son tus derechos, según la Ley General de Protección de Datos de Brasil (LGPD, Ley 13.709/2018) y, cuando corresponda, el Reglamento General de Protección de Datos de la UE (RGPD).

**Responsable del tratamiento:** Yan, desarrollador de Halyard.
**Contacto de privacidad (DPO):** halyardbrowser@gmail.com

## 1. En resumen

- **Tu historial, marcadores, pestañas, contraseñas que escribes y descargas se quedan solo en tu ordenador.** Halyard no tiene ningún servidor que reciba lo que navegas.
- **No vendemos, alquilamos ni compartimos datos con fines publicitarios.** Halyard no tiene anuncios ni rastreadores propios.
- **La cuenta es opcional.** Sin cuenta, Halyard no nos envía ningún dato personal.

## 2. Datos que se quedan solo en tu ordenador

Historial, marcadores, pestañas y espacios, configuración, permisos de sitios, lista de descargas, cookies y datos de los sitios que visitas, y el modelo de IA local (con todo lo que hablas con él). Estos datos están en la carpeta de Halyard de tu usuario de Windows. Las cookies se guardan cifradas. Puedes borrarlo todo en **Configuración › Privacidad › Borrar datos**, o con el botón de pánico.

## 3. Datos que tratamos si creas una cuenta

| Dato | Para qué | Base legal |
|---|---|---|
| Correo electrónico | Identificar la cuenta, iniciar sesión y recuperar la contraseña | Ejecución de un contrato |
| Contraseña | Iniciar sesión. Solo guardamos un hash (bcrypt), nunca la contraseña | Ejecución de un contrato |
| Nombre visible, idioma y tema | Sincronizar tus preferencias entre ordenadores | Ejecución de un contrato |
| Fechas de creación y modificación | Seguridad y soporte | Interés legítimo |

La cuenta usa **Supabase** (Supabase Inc.) como proveedor de autenticación y base de datos. Cada persona solo puede leer y cambiar su propia fila (seguridad a nivel de fila). **Ningún dato de navegación se envía a la cuenta.**

## 4. Servicios de terceros con los que Halyard se comunica

Para funcionar y protegerte, Halyard habla con algunos servicios. Ninguno recibe tu historial.

| Servicio | Cuándo | Qué recibe |
|---|---|---|
| **Proveedor de DNS seguro** (Cloudflare, Quad9 o Google, a tu elección) | Cada vez que abres un sitio | El nombre del sitio (así encuentra cualquier navegador una dirección). Puedes cambiarlo o desactivarlo. |
| **Buscador** elegido (DuckDuckGo por defecto) | Cuando buscas, o mientras escribes si las sugerencias están activadas | Lo que escribes en la barra de direcciones |
| **Ghostery / listas de bloqueo** | Una vez al día | Nada personal: solo descarga las listas |
| **malware-filter (GitLab)** | Cada 12 horas | Nada personal: solo descarga las listas de sitios peligrosos |
| **Have I Been Pwned** | Cuando escribes una contraseña en un sitio, si la comprobación está activada | Solo los 5 primeros caracteres del hash SHA-1 de la contraseña (k-anonimato). La contraseña nunca sale del ordenador. |
| **Google Traductor** | Solo cuando pides traducir una página | La dirección de la página |
| **Hugging Face** | Solo cuando descargas el modelo de IA | Nada personal: solo descarga el archivo |
| **GitHub** | Para buscar actualizaciones de Halyard | Nada personal: se compara la versión instalada con la más nueva |
| **Microsoft Defender** (en tu PC) | Al descargar programas, scripts y archivos comprimidos | Defender se ejecuta en tu ordenador y puede consultar la nube de Microsoft, según tu configuración de Windows |

Cada servicio tiene su propia política. Te recomendamos leer las de los que uses.

## 5. Cuánto tiempo guardamos los datos

Los datos de la cuenta se guardan mientras la cuenta exista. Cuando pides su eliminación al correo de contacto, borramos la cuenta y el perfil en un plazo de 15 días. Los datos locales se quedan en tu ordenador hasta que los borres.

## 6. Tus derechos

Puedes pedir en cualquier momento confirmación de que tratamos tus datos, acceso, rectificación, anonimización o supresión, portabilidad, información sobre con quién los compartimos, oposición y retirada del consentimiento. Escribe a **halyardbrowser@gmail.com**. Respondemos en un plazo de 15 días. También puedes reclamar ante la autoridad de protección de datos de tu país (en España, la AEPD).

## 7. Seguridad

Usamos conexiones cifradas (HTTPS y TLS 1.2 o superior), contraseñas con hash, cookies cifradas en el disco, claves de acceso públicas con seguridad por fila en la base de datos y el principio de mínimo privilegio. Ningún sistema es 100 % seguro. Si un incidente pudiera causarte un riesgo o daño relevante, te avisaremos a ti y a las autoridades.

## 8. Menores

Halyard no está dirigido a menores de 14 años, y no creamos cuentas a sabiendas para ellos.

## 9. Transferencias internacionales

Algunos proveedores (como Supabase y los servicios de la sección 4) pueden tratar datos fuera de tu país. Estas transferencias se hacen con proveedores que ofrecen garantías adecuadas de protección.

## 10. Cambios

Si esta política cambia de forma relevante, te avisaremos dentro del navegador antes de que el cambio entre en vigor. La fecha de arriba indica la última versión.
