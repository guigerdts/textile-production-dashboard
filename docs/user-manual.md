# Manual de usuario — Textile Production Dashboard

Manual de uso operativo del **Dashboard de Estampado**: la herramienta con la que el
operario registra y controla la ejecución de las órdenes de producción de la máquina
de estampado.

Este manual está escrito para alguien que **no conoce el proyecto ni su arquitectura**.
No hace falta saber programación para usarlo; sólo se necesitan conocimientos de
instalación de software en los pasos de la sección 2.

> **Documento de uso.** La entrada técnica del proyecto (arquitectura, decisiones,
> estado de desarrollo) está en el `README.md` de la raíz. Este manual no la repite.

---

## 1. Introducción

### Qué es el dashboard

Es una aplicación de escritorio (con opción de abrirse en el navegador) para el área
de **estampado** de una empresa textil. La planta tiene **una sola máquina de
estampado** con cinta transportadora, que imprime diseños sobre toallas.

El dashboard **registra y controla la ejecución** de las órdenes de producción:
cuántos golpes se hicieron, cuántas unidades salieron, qué paradas hubo, qué
daños ocurrió la máquina, qué tela se inspeccionó, qué mantenimiento se hizo y
cómo se compone el tiempo del turno.

### Para quién está pensado

- **Operario de estampado** — usuario principal: registra lecturas, paradas,
  actividades, daños, inspecciones y mantenimiento.
- **Gerencia** — autentica excepciones operativas (por ejemplo, autorizar el uso
  de una tela anómala).
- **Acabado** — no usa este dashboard: es quien determina oficialmente la calidad
  primera/segunda. Aquí sólo se registran sospechas (ver sección 13).

### Qué problema operativo resuelve

Antes, el seguimiento de la ejecución (golpes, paradas, tiempos, incidencias)
dependía de registros manuales dispersos y de la memoria del turno. El dashboard
concentra todo en un solo lugar, con reglas de negocio aplicadas por el sistema:
no se puede registrar algo imposible, y los valores derivados (producción,
avance, tiempo productivo) se calculan solos.

### Qué registra y qué NO registra

| El dashboard... | |
| --- | --- |
| ✅ Registra la ejecución de órdenes que llegan de fuera | |
| ✅ Registra lecturas del contador de golpes | |
| ✅ Registra paradas, actividades planificadas, daños, inspecciones de tela y mantenimiento | |
| ✅ Deriva producción, avance, tiempo productivo y proyección de 2da | |
| ❌ **NO** crea órdenes de producción | llegan de la programación semanal, hecha fuera del sistema |
| ❌ **NO** clasifica oficialmente la calidad | esa decisión es de Acabado |
| ❌ **NO** permite escribir el "tiempo productivo" a mano | siempre se calcula |
| ❌ **NO** gestiona personas, permisos ni roles | |

---

## 2. Requisitos e instalación (desde cero)

### 2.1 Requisitos de software

| Para qué | Qué necesitass | Versión validada en este proyecto |
| --- | --- | --- |
| Usar el dashboard en el navegador, y correr las pruebas | **Node.js con npm** | Node v22.23.3 / npm 10.9.9 |
| Usar la aplicación de escritorio (Tauri) | **Toolchain de Rust** + dependencias de sistema de Tauri | rustc 1.98.1 / cargo 1.98.1 |
| Generar el instalador de escritorio | Igual que lo anterior + `tauri-cli` | tauri-cli 2.11.4 (Tauri 2.x) |

Verifica las versiones con `node --version`, `npm --version`, `rustc --version`,
`cargo --version`. Las dependencias de sistema de Tauri se instalan según el
sistema operativo siguiendo la documentación oficial de Tauri 2.

### 2.2 Clonar e instalar

```bash
git clone https://github.com/guigerdts/textile-production-dashboard
cd textile-production-dashboard
npm install
```

No hay configuración adicional: no se piden claves, ni variables de entorno, ni
archivos de configuración de usuario.

### 2.3 Cómo iniciar en desarrollo

| Comando | Qué hace | Cuándo usarlo |
| --- | --- | --- |
| `npm run dev` | Servidor de desarrollo (Vite) en `http://localhost:1420` | Iterar en la interfaz desde el navegador |
| `npm run tauri dev` | Aplicación de escritorio completa en desarrollo | Probar la app real de escritorio |
| `npm run build` | Chequeo de tipos + build de producción | Verificar que compila |
| `npm run preview` | Vista previa del build de producción | Revisar el build |
| `npm run tauri build` | Paquete de escritorio instalable | Generar la distribución |

### 2.4 Navegador (Vite) vs. aplicación Tauri

- **`npm run dev`** abre la interfaz en el navegador. Es el camino más liviano y
  sirve para trabajar en pantallas y flujos. Necesitass que el puerto 1420 esté libre.
- **`npm run tauri dev`** abre la aplicación de escritorio con el motor nativo:
  es donde funciona la persistencia real en SQLite. **Requiere la toolchain de Rust
  y las dependencias de sistema de Tauri.**

Si `npm run tauri dev` o `npm run tauri build` fallan, revisa `rustc --version`,
`cargo --version` y las dependencias de sistema de Tauri para tu plataforma.

### 2.5 Después de instalar

Verificación recomendada tras clonar:

```bash
npm install
npx tsc --noEmit   # chequeo de tipos
npm test           # suite de pruebas
```

En máquinas con pocos núcleos:

```bash
npx vitest run --pool=threads --maxWorkers=1
```

---

## 3. Primer inicio

Cuando la aplicación arranca por primera vez con la base de datos vacía, ocurre
este proceso en orden:

1. **Inicialización de SQLite** — se crea la infraestructura de la base de datos y
   se aplican las migraciones numeradas (001 a 005). Este paso es automático.
2. **Apertura de los repositorios** — el sistema habilita los ocho almacenes
   persistidos: órdenes, jornada, lecturas de golpes, paradas, actividades
   planificadas, daños, inspecciones de tela y mantenimiento.
3. **Carga del programa de producción** — se materializa la programación del día.
   Hoy esa fuente son *fixtures* (datos de ejemplo cargados por el sistema), porque
   la programación semanal real todavía no está conectada (ver sección 20).
4. **Recuperación del estado guardado** — si había datos previos, se recuperan para
   el día operativo seleccionado.
5. **La aplicación se muestra** recién cuando todo lo anterior terminó bien.

### Qué debe esperar el usuario

- **La pantalla principal con datos reales desde el primer momento.** No hay un
  asistente de configuración ni pasos manuales de inicialización.
- **Si algo falla en la inicialización, la app NO se abre a medias.** Aparece una
  pantalla explícita con el texto:

  ```
  Error de inicialización: <detalle>
  ```

  En ese caso no se pierde el control de los datos: hay que resolver la causa
  (ver sección 17) y volver a abrir.

- **"Listo" significa**: ves la cabecera con la fecha operativa, el estado de la
  máquina y el resumen del turno, y ya puedes registrar eventos.

### Qué pasa con los datos

Los datos operativos viven en una base **SQLite** interna. El nombre del archivo es
`estampado.db` y lo resuelve el sistema según el sistema operativo y los directorios
de datos de la aplicación: **este manual no da una ruta física**, porque depende de
cada equipo (ver sección 16).

---

## 4. Conceptos básicos

Estos son los términos que verás en las pantallas. Todos pertenecen al vocabulario
del área de estampado.

| Término | Qué significa |
| --- | --- |
| **Día operativo** | La jornada de trabajo a la que pertenece un registro. No es "el instante en que escribiste algo": es el día que estás viendo y trabajando. Ver sección 14. |
| **Orden de producción** | Instrucción de imprimir un diseño sobre una referencia de tela en una cantidad pedida de unidades. Llega de la programación semanal, creada fuera del sistema. |
| **Diseño** | El dibujo que se imprime sobre la toalla (por ejemplo, "Jessie"). Se empareja con una referencia de tela para definir la orden. |
| **Máquina de estampado** | La única máquina de la planta: mesa plana con cinta transportadora, 7 carros numerados (1–7) y horno de secado. |
| **Golpe** | Un ciclo de prensa de la mesa. La máquina cuenta los golpes automáticamente; **nada más es automático**. |
| **Unidades** | Toallas terminadas. Se cuentan como solicitadas, producidas, primera y segunda. **1 golpe = 3 unidades.** |
| **1ra / 2da** | 1ra = toallas que cumplen calidad; 2da = las que fallan. La clasificación **oficial** la hace Acabado; Estampado sólo registra sospechas. |
| **Pintura reactiva** | Tinta reactiva: requiere un secado en horno durante la impresión y además un pasaje posterior de termofijado. |
| **Pintura pigmento** | Tinta pigmento: un solo paso por el horno; la velocidad de la máquina controla el secado. |
| **Parada** | Detención **imprevista** de la máquina, con una causa predefinida. Es una incidencia. |
| **Actividad planificada** | Tiempo no productivo **autorizado de antemano** (cambio de diseño, limpieza, almuerzo, pausa). No es una incidencia. |
| **Daño** | Evento independiente: algo de la máquina se dañó (eléctrico, mecánico u operacional), con componente, reparación y solución. |
| **Inspección de tela** | Revisión de la tela cada vez que llega un lote nuevo, antes de imprimir. |
| **Mantenimiento** | Registro documental sobre la máquina: preventivo o reactivo. No descuenta tiempo productivo por sí solo. |

### Reglas que conviene tener claras desde el principio

- **1 golpe = 3 unidades.** El sistema hace esa conversión siempre.
- **La programación semanal viene de fuera.** El dashboard no crea órdenes: las
  recibe y controla.
- **Acabado decide la 2da oficial.** Lo que ves aquí es sospecha operativa.
- **El tiempo productivo nunca se carga a mano:** se calcula (sección 15).

---

## 5. Flujo de trabajo diario

Flujo recomendado de principio a fin. A la derecha se indica quién hace qué.

| # | Paso | Quién |
| --- | --- | --- |
| 1 | Revisar la **fecha operativa** en la cabecera y cambiarla si corresponde (sección 14) | usuario |
| 2 | Revisar la **orden del día**: diseño, tela, unidades solicitadas, golpes requeridos | sistema muestra / usuario verifica |
| 3 | **Iniciar producción**: cargar operario y lectura inicial del contador | usuario introduce |
| 4 | A lo largo del día, **registrar lecturas de golpes** con el valor absoluto del contador | usuario introduce |
| 5 | Cuando la máquina se detenga sin previsto, **registrar la parada** y **cerrarla** al reanudar | usuario introduce |
| 6 | Cuando corresponda, **registrar actividades planificadas** (cambio de diseño, limpieza, almuerzo, pausa) y cerrarlas | usuario introduce |
| 7 | Si algo se rompió, **registrar el daño** (y cerrarlo cuando termine la reparación) | usuario introduce |
| 8 | Al llegar tela nueva, **registrar la inspección** antes de producir | usuario introduce |
| 9 | Si hubo reparación planificada o reactiva, **registrar el mantenimiento** | usuario introduce |
| 10 | Al terminar, **finalizar la orden** | usuario introduce |

**Qué calcula el sistema (sin que nadie lo pida):**

- producción actual (golpes y unidades) a partir de las lecturas;
- unidades y golpes restantes;
- avance de la orden;
- estado de calidad ("Buena racha" / "Alerta") y 2da proyectada;
- los cuatro tiempos del turno: disponible, planificado, incidencias y productivo;
- duraciones de paradas, actividades, daños y mantenimientos abiertos.

**Qué bloquea el sistema (y avisa con un mensaje):**

- lecturas mientras hay una parada abierta;
- lecturas en una orden finalizada o no iniciada;
- lecturas que hacen retroceder el contador;
- cerrar la orden con una parada abierta;
- registrar una segunda parada sin cerrar la anterior;
- registrar un segundo daño o mantenimiento abierto a la vez;
- cualquier registro en un día que no es hoy (día histórico).

---

## 6. Órdenes y producción

### Estados de una orden

| Estado visible | Significado | Qué puedes hacer |
| --- | --- | --- |
| **Disponible** | Llegó de la programación, aún no se arrancó | Iniciar producción; registrar inspección de tela, daños, mantenimiento, actividades, fin de jornada |
| **En producción** | Ya se arrancó y hay lecturas | Registrar lecturas, paradas, todo lo anterior, y finalizar |
| **Finalizada** | Se declaró terminada | **Sólo consulta**: todos los formularios de registro desaparecen |

### Cómo se inicia

Con la orden en estado *Disponible*, aparece el formulario **"Iniciar producción"**:

- **Operario (obligatorio)** — nombre del operario.
- **Lectura inicial del contador (obligatoria, ≥ 0)** — valor absoluto que marca la
  máquina en ese momento.
- Botón **Iniciar producción**.

El sistema valida y, si hay problemas, los lista en rojo bajo el botón. Errores
reales que puede devolver:

- `solo se puede iniciar una orden disponible`
- `la lectura del contador debe ser un número entero mayor o igual a 0`
- `operatorName es obligatorio`

### Cómo se calcula el avance

La tarjeta de la orden muestra, para cualquier estado:

| Dato de la tarjeta | Quién lo calcula |
| --- | --- |
| Diseño, Referencia de tela, Tipo de pintura | sistema (datos de la orden) |
| Unidades solicitadas | sistema |
| Segunda: *Aplica* / *No aplica* | sistema |
| Porcentaje proyectado (si aplica segunda) | sistema |
| Objetivo proyectado | **sistema**: `unidades solicitadas + proyección de 2da`, redondeado hacia arriba |
| Golpes requeridos | **sistema**: `objetivo proyectado ÷ 3`, redondeado hacia arriba |
| Lectura inicial / Última lectura | sistema, a partir de las lecturas |
| Producción actual (`N golpes / M unidades`) | **sistema** |
| Unidades restantes / Golpes restantes | **sistema** |

El operario **nunca** ingresa producción: sólo lee el contador y anota el número.

### Cómo se finaliza

Botón **Finalizar producción** (visible sólo en *En producción* y sólo en el día de
hoy). Errores posibles:

- `solo se finaliza una orden en producción`
- `la orden ya está finalizada`
- `hay una parada abierta. Registre el fin antes de finalizar la orden`

Y mientras hay parada activa, el propio botón queda deshabilitado con el aviso:
*"Cierre la parada activa antes de finalizar la orden"*.

### Orden finalizada con cero golpes

**Está permitido.** Finalizar no exige producción mínima: una orden puede cerrarse
con 0 golpes (por ejemplo, se canceló el trabajo). Al finalizarla, la tarjeta pasa a
mostrar **Producción real**, **Fecha/hora de finalización** y el **Resumen de
lecturas**.

### Qué queda bloqueado después de finalizar

Todos los formularios de escritura de la orden: registrar lecturas, paradas,
inspecciones, daños, mantenimiento y actividades **de esa vista** no se muestran.
El día queda en modo consulta.

---

## 7. Lecturas de golpes

Campo: **"Nueva lectura del contador (absoluta)"**, dentro del formulario
**"Registrar lectura"**.

> **Regla de oro:** el sistema trabaja con lecturas **absolutas** del contador, no
> con deltas. Nunca sumes ni restes: mira el número que marca la máquina y
> anotalo tal cual.

### Ejemplo práctico

Orden: 2.400 unidades solicitadas, sin proyección de 2da → **800 golpes requeridos**.

| Paso | Contador de la máquina | Que hazs | Resultado del sistema |
| --- | --- | --- | --- |
| Inicio | 1.200 | cargas `1200` como lectura inicial | contador base = 1.200 |
| 1ª lectura | 1.350 | cargas `1350` | +150 golpes → +450 unidades |
| 2ª lectura | 1.400 | cargas `1400` | +50 golpes → +150 unidades |
| Lectura repetida | 1.400 | cargas `1400` | **aviso**: `Sin incremento desde la última lectura`; **no** suma unidades |
| Lectura menor | 1.380 | cargas `1380` | **error**: `el contador no puede retroceder`; no cambia nada |

### Relación golpes ↔ unidades

- **1 golpe = 3 unidades** (siempre).
- Unidades producidas = golpes acumulados × 3.
- Golpes necesarios para una cantidad de unidades = unidades ÷ 3, redondeado hacia arriba.

### Por qué no se introduce un delta manual

Porque el contador de la máquina es una fuente absoluta y acumulativa. Si el
sistema aceptara deltas, un registro erróneo se propagaría sin control y no habrea
cómo detectarlo. Con lecturas absolutas, cualquier retroceso es visible y se rechaza.

### Errores que puede devolver

- `solo se registran lecturas en una orden en producción`
- `la orden no tiene contador base; debe iniciarse primero`
- `el contador no puede retroceder`
- `la lectura del contador debe ser un número entero mayor o igual a 0`
- `no se pueden registrar lecturas mientras hay una parada abierta`
- `la orden ya está finalizada`

Y si hay parada activa, el formulario se deshabilita y muestra:
*"La producción está detenida por una parada activa"*.

---

## 8. Paradas

Sección **"Paradas / incidencias"**. Una parada es una detención **imprevista** de
la máquina.

> **Importante:** esta sección aparece cuando la orden está **En producción**.
> En un día sin orden, con orden disponible o finalizada no hay formulario de paradas.

### Cuándo registrar una

En cuanto la máquina se detenga por algo no previsto y no esté cubierto por una
actividad planificada (sección 9). Registrarla en el momento es lo que hace
correcto el cálculo de incidencias del turno.

### Causas disponibles (las 10 reales del sistema)

| # | Causa | Datos que pide además |
| --- | --- | --- |
| 1 | Falta de color / tinta | Color |
| 2 | Rotura o deterioro del cuadro | Número de carro |
| 3 | Atasco o rotura de tela en la máquina | — |
| 4 | Daño mecánico en carro | Número de carro, Componente |
| 5 | Problema eléctrico | Componente |
| 6 | Necesidad de ajuste de registro | Carros afectados (separados por coma) |
| 7 | Problema con el horno de secado | — |
| 8 | Falta de materia prima (tela) | — |
| 9 | Cambio de diseño no contemplado en programación | — |
| 10 | Otro (requiere observación) | Observaciones (**obligatorias**) |

Todas aceptan además **Observaciones** (texto libre). Para la causa *"Otro"* son
obligatorias.

### Apertura y cierre

1. Elige la causa, completa los campos que pide esa causa y **Registra la parada**.
2. La parada queda **abierta**: aparece **"Parada activa:"** con la causa, la hora
   de inicio y la duración en vivo.
3. Al reanudar, presiona **Cerrar parada**. La duración se cierra con ese momento.

Mientras hay una parada abierta:

- **No se pueden registrar lecturas** (el formulario queda inutilizado).
- **No se puede finalizar la orden.**
- Sólo puede haber **una parada abierta a la vez**.

### Diferencia entre parada y daño

| | Parada | Daño |
| --- | --- | --- |
| ¿Qué es? | La **detención** de la máquina | El **evento** de que algo se rompió |
| ¿Siempre hay? | Sólo si la parada causó detención | Puede existir sin detener la máquina |
| ¿Afecta el tiempo productivo? | **Sí**, se descuenta como incidencia | **No** por sí solo |
| ¿Se registra juntos? | — | Un daño **puede** vincularse opcionalmente a la parada que causó |

Un mismo evento puede generar ambos registros, pero son cosas distintas y se
registran por separado.

---

## 9. Actividades planificadas

Sección **"Actividades planificadas"**. Son las pausas **autorizadas de antemano**.

### Tipos disponibles

| Tipo | Cuándo |
| --- | --- |
| **Cambio de diseño** | Al pasar de una orden a otra |
| **Limpieza** | Limpieza autorizada (si el día es martes, al elegir *Limpieza* el sistema precarga el texto editable *"Limpieza estándar (7:00–8:00)"*; el campo admite cualquier texto) |
| **Almuerzo** | Pausa de mediodía |
| **Pausa** | Pausa corta autorizada |

### Campos

- **Tipo de actividad** (obligatorio).
- **Qué se limpió** — sólo se pide si el tipo es *Limpieza*.
- **Operario de la actividad** (obligatorio).
- **Observaciones** (opcional).

Se registran con **Registrar actividad** y se cierran con **Cerrar actividad**.
Aparece **"Actividad activa:"** con el tipo y la hora de inicio mientras dura.

Errores posibles:

- `debe seleccionar un tipo de actividad`
- `operatorName es obligatorio`
- `debe indicar qué se limpió` (cuando el tipo es limpieza)
- `debe indicar el timestamp de fin` / `el timestamp de fin no puede ser anterior al de inicio`

### Actividad planificada vs. parada/incidente

| | Actividad planificada | Parada (incidencia) |
| --- | --- | --- |
| ¿Prevista? | Sí, autorizada | No, imprevista |
| ¿Afecta el resumen como incidencia? | **No** | **Sí** |
| ¿Descuenta tiempo productivo? | **Sí**, por el rubro *Planificado* | **Sí**, por el rubro *Incidencias* |
| ¿Bloquea lecturas? | No | Sí |

Ambas descuentan tiempo productivo, pero por rubros distintos: el sistema las
muestra separadas para que se vea **por qué** el tiempo productivo bajó.

---

## 10. Daños

Sección **"Daños / eventos"**. Un daño es un evento **independiente**: algo de la
máquina se dañó.

### Campos del registro

| Campo | Detalle |
| --- | --- |
| **Tipo de daño** | *Daño eléctrico*, *Daño mecánico* o *Daño operacional* |
| **Componente afectado** | obligatorio (ej.: *"eje trasero"*) |
| ☐ **Este daño causó una parada** | opcional; al marcarlo aparece **Parada vinculada** para elegir la parada |
| ☐ **Posible segunda** | opcional; al marcarlo aparece **Unidades sospechadas (opcional)** |
| **Observaciones** | texto libre |
| Botón | **Registrar daño** |

Al cerrarlo (**Cerrar daño**) se piden:

- **Fin de la reparación** (fecha y hora).
- **Solución aplicada (obligatoria)** — ej.: *"Cambio de eje y lubricación"*.

### Relación con la parada

Es **opcional y no automática**: marcar *"Este daño causó una parada"* obliga a
elegir la parada; no marcarlo obliga a no elegir ninguna. El sistema valida que la
parada exista, sea de la misma máquina, de la misma orden y que no empiece antes
que el daño.

**Un daño no equivale automáticamente a tiempo de parada.** El tiempo se descuenta
sólo si además existe (y se cierra) una parada. Si la máquina siguió andando, el
daño es un registro documental que no descuenta productividad.

### Relación con la 2da

Si el daño pudo haber arruinado toallas, se marca **Posible segunda** y, si se sabe
cuántas, se cargan las **unidades sospechadas**. Esas unidades alimentan la
**proyección de 2da** (sección 13). Si se marca la sospecha sin cargar unidades, el
sistema lo muestra igualmente como nota cualitativa.

### Restricciones

- Sólo **un daño abierto** por máquina a la vez:
  `ya hay un daño abierto para la máquina. Cierre el daño actual antes de registrar otro`
- Errores frecuentes:
  - `el componente afectado es obligatorio`
  - `si el daño causó una parada, debe indicar la parada vinculada`
  - `si el daño no causó parada, no debe indicar parada vinculada`
  - `unidadesSospechadas debe ser un entero mayor o igual a 0`
  - `el timestamp de fin no puede ser anterior al de inicio`
  - `debe indicar la solución aplicada`

---

## 11. Inspección de tela

Sección **"Inspección de tela"**. Se registra **cada vez que llega un lote nuevo
de tela y antes de imprimirlo**.

> Sólo aparece cuando hay una orden (necesita una orden a la que pertenecer). En un
> día vacío no hay formulario de inspección.

### Qué se revisa

Checklist de 5 ítems, cada uno con dos opciones: **Conforme** o **Anomalía**.
Los 5 ítems son fijos y siempre deben tener estado explícito:

1. **Absorción**
2. **Tundido**
3. **Manchas**
4. **Dimensiones / medidas**
5. **Estado general**

Además:

- **Operario** (obligatorio; se precarga con el operario de la orden y queda
  bloqueado, para que la inspección quede a nombre de quien está produciendo).
- **Lote (opcional)** — texto libre, ej.: *"L-103"*.
- **Otra anomalía (opcional)** — ej.: *"olor fuerte, deformación…"*.
- **Observaciones (opcional)**.

Botón: **Registrar inspección**.

### Si hay anomalía: devolución o autorización

Con una anomalía registrada, el sistema ofrece dos caminos **excluyentes**, elegidos
en el campo **Tipo de resolución**:

| Opción | Qué implica | Campos que aparecen |
| --- | --- | --- |
| **Devolución de tela** | La tela se devuelve, no se imprime | **Motivo (obligatorio)**, **Registrada por (obligatorio)** |
| **Autorización de gerencia** | Gerencia autoriza usar la tela igual | **Autorizado por (obligatorio)**, **Observaciones (opcional)** |

La fecha y la hora de la resolución las pone el sistema, no se cargan.
La opción **Devolución de tela** sólo se ofrece mientras la orden tiene
**0 golpes** de producción; una vez que se empezó a imprimir, no aparece.

Errores relevantes:

- `no se puede devolver tela de una inspección sin anomalías`
- `no se puede autorizar el uso de tela de una inspección sin anomalías`
- `la inspección ya tiene una resolución registrada`
- **`la devolución de tela solo se permite antes de imprimir (producción 0)`**
- `el motivo de la devolución es obligatorio`
- `debe indicar el estado de los 5 ítems del checklist`

### Si la tela no está autorizada

Queda registrada la devolución y la tela no se usa en esa orden. No hay tela
"entre estados": cada inspección queda con una resolución ya tomada. El estado que
se deriva de cada inspección se muestra en el historial como **Conforme**,
**No usable**, **Devuelta** u **Uso autorizado**.

---

## 12. Mantenimiento

Sección **"Mantenimiento"**.

### Tipos

| Tipo | Cuándo | Vínculo con daño |
| --- | --- | --- |
| **Mantenimiento reactivo** | Como consecuencia de un daño | **Opcional**: se puede elegir el daño (o *"Sin vínculo"*) |
| **Mantenimiento preventivo** | Según la necesidad de la máquina (no hay periodicidad fija) | **No puede** vincularse a un daño |

### Campos

- **Tipo de mantenimiento** (obligatorio).
- **Motivo (obligatorio)** — ej.: *"Fusible quemado, fuga de tinta"*.
- **Daño vinculado** — sólo para reactivo.
- ☐ **Registro completo (con fin)** — si se marca, pide **"Qué se revisó /
  reparó (obligatorio)"**. Si no se marca, el registro queda **abierto** (en curso).
- **Observaciones**.

Botón: **Registro completo** (con fin) o **Registrar mantenimiento** (sin fin).

Para cerrar un mantenimiento abierto: **Cerrar mantenimiento**, con **Fin de la
reparación** y **Qué se revisó / reparó (obligatorio)**.

### Reglas

- **Sólo un mantenimiento abierto por máquina** a la vez:
  `ya hay un mantenimiento abierto para la máquina. Cierre el actual antes de registrar otro`
- La duración **nunca se carga**: se deriva de inicio y fin.
- **Un mantenimiento no descuenta tiempo productivo.** Es un registro documental.
  Si la máquina se detuvo a causa de eso, además hay que registrar la **parada**
  (sección 8), que es lo único que descuenta.

Errores frecuentes:

- `el motivo es obligatorio`
- `el mantenimiento preventivo no puede tener danoId`
- `queSeRevisoReparo es obligatorio al cerrar`
- `el timestamp de fin no puede ser anterior al de inicio`

---

## 13. 2da y calidad

### Conceptos separados

El sistema mantiene **tres cosas distintas** y no las mezcla:

| Concepto | Quién lo define | Dónde se ve |
| --- | --- | --- |
| **2da planificada** | El porcentaje de 2da que la orden trae (sólo si la orden aplica segunda) | Tarjeta de orden: *Segunda: Aplica*, *Porcentaje proyectado* |
| **2da sospechada** | Estampado, al registrar daños con *"Posible segunda"* | Se suma en la proyección |
| **2da oficial** | **Acabado** (fuera del sistema) | No está en el dashboard |

### Cómo se calcula la proyección

La sección **"Proyección de 2da"** (visible en órdenes en producción y finalizadas)
muestra:

| Dato | Qué es | Quién lo calcula |
| --- | --- | --- |
| **2da proyectada** | `unidades sospechadas ÷ unidades producidas` | sistema |
| **Meta de referencia** | **5,0 %** — referencia mensual | sistema |
| **Estado** | **Buena racha** / **Alerta** / **—** (sin datos) | sistema |

Y en la parte superior del dashboard aparece el resumen:
**"Buena racha · X %"** o **"Alerta · X %"**.

### Umbral de alerta

- La alerta salta **por encima de 3 %** de 2da proyectada.
- **Exactamente 3 % no genera alerta**: cuenta como *Buena racha*. Sólo superarlo
  la genera.
- Sin producción, no hay proyección: el estado es **"—"**.

### Buena racha

*"Buena racha"* significa: hay producción y la proyección está dentro del umbral
(≤ 3 %). Es un estado **operativo del momento**, no una demostración de historial
ni de continuidad de la máquina.

### Sospecha vs. clasificación oficial

> Lo que ves aquí es **sospecha de Estampado**. La clasificación **oficial** de
> primera/segunda la determina **Acabado**. El dashboard no la recibe todavía
> (sección 20), así que nunca leas estos números como calidad oficial.

Nota adicional: si hay daños marcados como *"Posible segunda"* **sin** unidades
cargadas, el sistema avisa:

```
N daños con sospecha de 2da sin unidades cuantificadas
```

Esa sospecha es cualitativa: se ve, pero no aporta número a la proyección.

---

## 14. Día operativo e histórico

**Esta es la sección más importante si vas a consultar días anteriores.**

### Qué es el día operativo

Es la **jornada a la que pertenece un registro**, no el instante en que se escribió.
Cada parada, actividad, daño y mantenimiento pertenece a **un único día operativo**,
y esa fecha **no cambia aunque el evento se cierre a la medianoche**: una parada
abierta la noche del 11 y cerrada la madrugada del 12 **sigue siendo del día 11**.

En la cabecera se lee:

```
Fecha operativa: 2026-09-11
```

### "Hoy" vs. día operativo seleccionado

| | Hoy | Día operativo seleccionado |
| --- | --- | --- |
| ¿Qué es | El día calendario real | El día que estás viendo |
| ¿Se puede escribir? | **Sí** | **Sólo si coincide con hoy** |
| ¿Cómo se sabe? | El sistema lo determina | Comparación: si el día seleccionado ≠ hoy → **sólo lectura** |

**Día histórico = sólo lectura.** Todos los formularios de registro se ocultan, y
si algo intenta escribir de todos modos, el sistema lo rechaza con:

```
no se puede registrar en un día que no es hoy
```

**Hoy se comporta exactamente como siempre:** la única diferencia es que puedes
volver a él.

### Cómo seleccionar otro día

En la cabecera, junto a la fecha, hay tres controles:

- **Fecha operativa** — campo de fecha (calendario).
- Botón **"Día operativo anterior"** (flecha ◀).
- Botón **"Día operativo siguiente"** (flecha ▶).

Durante el cambio, los tres controles quedan inoperativos para evitar cargas
duplicadas. Si el día no se puede cargar, aparece:

```
No se pudo cargar ese día: <detalle>
```

### Qué puede consultarse históricamente

- la orden de ese día y su estado;
- sus lecturas y su producción;
- sus paradas, actividades, daños, inspecciones y mantenimientos;
- el resumen de tiempo de ese turno.

### Qué cambia al navegar a una fecha anterior

- Se muestran **los registros de ese día**, no los de hoy.
- Los formularios de escritura **desaparecen**.
- Los indicadores de estado de la máquina reflejan **ese día**.

### Los registros abiertos pertenecen a su fecha

Los banners de **daño activo** y **mantenimiento activo** se calculan con los
eventos **del día seleccionado**. Por eso:

- Un día histórico **sin** registros abiertos **no muestra banner** aunque hoy haya
  un daño abierto: ese daño es de hoy, no de ese día.
- Nunca vas a ver en un día anterior el estado que está abierto **hoy**.

---

## 15. Tiempo productivo

Sección **"Resumen del turno"** (visible en todos los estados de la orden, incluso
en día vacío).

### Campos

| Campo | Qué muesta |
| --- | --- |
| **Jornada: 07:00 → 17:00** | Ventana de trabajo del turno |
| **Tiempo disponible** | De inicio a fin de la jornada |
| **Planificado** | Suma de actividades planificadas |
| **Incidencias** | Suma de paradas |
| **Productivo** | Lo que quedó para producir |

### Cómo se calcula

```
Tiempo productivo = Tiempo disponible − (planificado ∪ incidencias)
```

- **Jornada base: 07:00 a 17:00.** El **fin de jornada es editable** con el campo
  **"Fin de jornada (overtime incluido)"** + botón **"Guardar fin de jornada"**:
  así se incorporan las horas extras. El inicio no se carga.
- **Planificado** = unión de las actividades planificadas.
- **Incidencias** = unión de las paradas.
- Los registros **abiertos** (sin cerrar) se computan hasta el momento actual.
- El tiempo productivo **nunca se escribe a mano**: deriva de todo lo anterior.

### Por qué una actividad solapada no se descuenta dos veces

Porque el sistema suma **intervalos unidos**, no tiempos uno detrás de otro. Si una
actividad planificada y una parada se solapan en 20 minutos, esos 20 minutos se
descuentos **una sola vez**. Lo mismo vale entre dos actividades solapadas o entre
dos paradas.

> Esto es también por qué **no** se debe registrar una parada para "explicar" un
> tiempo que ya cubre una actividad planificada: duplicaría el registro sin
> cambiar el resultado, pero ensuciaría el historial.

---

## 16. Persistencia y recuperación

- **Los datos operativos se guardan en SQLite.** El archivo se llama `estampado.db`
  y lo resuelve el sistema dentro de los directorios de datos de la aplicación de tu
  sistema operativo. **No hay una ruta fija que puedas anotar de antemano.**
- **Al cerrar y reabrir la aplicación**, el sistema vuelve a leer la base y
  restaura: la orden del día, la jornada, las lecturas de golpes y los cinco eventos
  operativos (paradas, actividades, daños, inspecciones, mantenimiento).
- **"Recuperación"** significa eso: al arrancar, el sistema reconstruye el estado
  del día operativo desde lo guardado. **No** significa deshacer nada ni pedirte
  que vuelvas a cargar datos.
- Los valores **derivados** (producción, avance, tiempos, proyecciones) **no se
  guardan**: se recalculan cada vez que se necesitan.

### Qué NO debe asumir el usuario

- **No asumas una ruta de la base de datos**: depende del sistema operativo y de la
  instalación.
- **No asumis que cerrar la ventana borra datos**: se persisten.
- **No asumis que dos máquinas ven los mismos datos**: es una aplicación individual
  por equipo.
- **No borres el archivo de base de datos** salvo que quieras reiniciar todo desde
  cero (sección 17).

---

## 17. Errores y situaciones frecuentes

### No puedo registrar una lectura

| Causa | Qué dice el sistema | Qué hacer |
| --- | --- | --- |
| Hay una parada abierta | *"La producción está detenida por una parada activa"* | Cierra la parada (sección 8) |
| La orden no está en producción | `solo se registran lecturas en una orden en producción` | Inicia la producción primero |
| No se cargó lectura inicial | `la orden no tiene contador base; debe iniciarse primero` | Vuelve a *Disponible* e inicia |
| La orden está finalizada | `la orden ya está finalizada` | Es sólo consulta |

### La lectura es menor

`el contador no puede retroceder` — **no cambia nada**. Revisa el número que marca
la máquina; probablemente se anotó mal. Nunca corrijas "para que cuadre": el
contador absoluto es la fuente.

### Hay una parada abierta

Bloquea **lecturas** y **finalizar la orden**. Cierra la parada con **Cerrar parada**.

### La orden aparece finalizada

Es un estado terminal: los formularios desaparecen a propósito. Sirve para consulta.

### No veo un registro al consultar otra fecha

- Cada registro pertenece a **un solo día operativo**: revisa que estés en la fecha
  correcta (cabecera *Fecha operativa*).
- Un registro **abierto hoy** no aparece como abierto en un día anterior.
- Un día sin orden muestra *"No hay orden asignada para hoy."* y sólo las secciones
  que no dependen de orden (resumen, actividades, daños, mantenimiento).

### Aparece una alerta de 2da

Significa que la proyección superó el 3 %. Revisa los daños marcados con
*"Posible segunda"* y sus unidades sospechadas. **No es una clasificación oficial**
(sección 13).

### La aplicación no inicia

- Pantalla **`Error de inicialización: <detalle>`**: anota el detalle. La app no
  monta a medias, por diseño.
- Si persiste, puede tratarse del estado de la base de datos (ver abajo).

### Problemas de instalación

- **`npm install` falla**: limpiá la caché de npm y reintentá.
- **Falta Node/npm**: instalá Node 22.x (versión validada: v22.23.3 / npm 10.9.9).

### Problemas de build / Tauri

- **`npm run tauri dev` o `npm run tauri build` fallan**: verifica
  `rustc --version`, `cargo --version` y las dependencias de sistema de Tauri.
- **Puerto 1420 ocupado** en `npm run dev`: cierra el proceso que lo use.

### `npm run dev` vs `npm run tauri dev`

| | `npm run dev` | `npm run tauri dev` |
| --- | --- | --- |
| Qué abre | Navegador en `http://localhost:1420` | Aplicación de escritorio |
| Requiere Rust | No | Sí |
| Sirve para | Iterar en la interfaz | El uso real, con persistencia |

### Base de datos con estado incompatible

Si la base existente tiene un esquema viejo, el arranque puede fallar a propósito
antes que inventar datos. En ese caso, **borrar `estampado.db` de la carpeta de
datos de la aplicación** reinicia todo desde cero (perdés el historial local).
Busca la carpeta de datos de la aplicación de Tauri para tu sistema operativo.

---

## 18. Buenas prácticas para operarios

1. **Registra los eventos en el momento.** Paradas, actividades y daños pierden
   valor si se cargan al final del turno de memoria.
2. **Usa lecturas absolutas.** Mira el contador de la máquina y anota el número
   tal cual; nunca sumes deltas.
3. **No alteres datos para "hacer cuadrar" la producción.** Si el contador no
   cuadra, el error está en el registro, no en la producción.
4. **Cierra las paradas** al reanudar. Una parada abierta bloquea lecturas y el
   cierre de la orden, y deforma el tiempo del turno.
5. **Cierra las actividades planificadas** al terminarlas.
6. **Documentá las observaciones.** Causa "Otro", motivo de mantenimiento y
   solución aplicada son lo que después explica el historial.
7. **Inspeccioná la tela antes de producir.** Después de imprimir, la devolución
   ya no está disponible.
8. **Distinguí daño de parada.** Si no hubo detención, no registres parada; si hubo
   detención, registra las dos cosas.
9. **Vinculá el daño con la parada** cuando corresponda: es lo que hace coherente
   el relato del turno.
10. **Revisa la fecha operativa** antes de registrar. Registra en el día correcto.

---

## 19. Glosario

| Término | Definición breve |
| --- | --- |
| **Día operativo** | Jornada a la que pertenece un registro; distinto del instante de escritura. |
| **Orden de producción** | Instrucción de imprimir un diseño sobre una tela en una cantidad de unidades. Viene de fuera. |
| **Diseño** | Dibujo que se imprime sobre la toalla. |
| **Máquina de estampado** | Única máquina del área: mesa plana, 7 carros, horno. |
| **Golpe** | Un ciclo de prensa. 1 golpe = 3 unidades. |
| **Unidades** | Toallas terminadas (solicitadas, producidas, 1ra, 2da). |
| **1ra** | Toalla que cumple calidad. |
| **2da** | Toalla que falla calidad; clasificada oficialmente por Acabado. |
| **Pintura reactiva** | Tinta que requiere secado en horno y termofijado posterior. |
| **Pintura pigmento** | Tinta con un solo paso por el horno. |
| **Parada** | Detención imprevista con causa predefinida; descuenta tiempo como incidencia. |
| **Actividad planificada** | Pausa autorizada (cambio de diseño, limpieza, almuerzo, pausa). |
| **Daño** | Evento de avería de la máquina, con componente, reparación y solución. |
| **Inspección de tela** | Revisión de un lote de tela antes de imprimir. |
| **Devolución de tela** | Resolución de una inspección con anomalía: la tela se devuelve. |
| **Mantenimiento** | Registro preventivo o reactivo sobre la máquina; no descuenta productividad. |
| **Tiempo disponible** | De inicio a fin de la jornada. |
| **Tiempo productivo** | Disponible menos planificado menos incidencias; nunca se carga a mano. |
| **Buena racha** | Estado de calidad con proyección de 2da dentro del umbral. |
| **Acabado** | Área que determina oficialmente 1ra/2da. |
| **Gerencia** | Autoriza excepciones (p. ej. uso de tela anómala). |

---

## 20. Limitaciones conocidas

Sólo lo que afecta el uso real:

| Limitación | Qué significa en la práctica |
| --- | --- |
| **La programación semanal no está conectada** | Las órdenes cargadas son de ejemplo (**fixtures** con fechas fijas: *OP-101 "Jessie"* y *OP-102 "Palm"*). En una fecha sin orden cargada verás *"No hay orden asignada para hoy."* Hasta que se conecte la fuente real, el día con orden es el de esas fechas. |
| **No hay clasificación oficial de 2da** | El dashboard muestra sospechas y su proyección; el dato oficial de Acabado todavía no llega. |
| **La persistencia del escritorio no está validada en runtime real** | Los adaptadores SQLite están probados, pero el transporte de la aplicación de escritorio mereció validación pendiente. Si en escritorio algo no se guarda, repórtalo con lo que indique la sección 21. |
| **Una sola máquina (M1)** | El dashboard modela exclusivamente la máquina de estampado. |
| **No hay gestión de usuarios** | No hay login ni roles: la identidad del operario se escribe en cada registro. |

---

## 21. Contacto / soporte

No hay un canal de soporte definido todavía. **Para reportar un problema**, recopilá:

1. **Qué estabas haciendo** (paso a paso, desde qué pantalla).
2. **Qué esperabas que pasara** y **qué pasó realmente**.
3. **El mensaje exacto** que mostró el sistema (copialo tal cual).
4. **La fecha operativa** visible en la cabecera.
5. **El número de orden**, si había una en pantalla.
6. **Si fue en navegador (`npm run dev`) o en la aplicación de escritorio.**
7. **Si el problema apareció al iniciar** (pantalla de error de inicialización):
   el detalle completo de ese mensaje.
8. **Si se perdió información**: qué registro faltaba y en qué momento lo habías
   cargado.

Con esa información, el problema es reproducible sin tener que adivinar nada.
