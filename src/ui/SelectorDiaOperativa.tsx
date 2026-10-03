/**
 * SelectorDiaOperativa — navegador de UN día operativo (tareas 9.1 y 9.6).
 *
 * Tres elementos NATIVOS a propósito (DD9): `<input type="date">` aporta teclado,
 * lector de pantalla, formato del locale y picker sin código nuestro; las flechas
 * son `<button type="button">` (sin `href`, sin semántica de navegación) con
 * `aria-label` propio, y el campo va dentro de un `<label>`. Un widget hecho a
 * mano exigiría sus propias pruebas de foco, teclado y formato sin ganancia
 * visible para el operario.
 *
 * **OQ-2 (design §12 Q2) — declarada acá, NO respondida en código:**
 * el límite superior de selección es **hoy** (`max={hoy}` y la flecha «siguiente»
 * deshabilitada en hoy) y el límite inferior es el **pasado abierto**, sin piso.
 * `specs/historical-day-navigation/spec.md` no requiere fecha mínima, así que
 * aquí NO se inventa lógica de `min` ni ninguna otra cota inferior. Si más
 * adelante se quiere acotar hacia atrás, pertenece a un cambio que la registre
 * como regla de dominio — no a este componente.
 *
 * Exactamente UN día, nunca un rango: el selector no tiene par inicio/fin, y la
 * suma de `max` + flecha siguiente deshabilitada en hoy hace que "un solo día"
 * sea estructural en lugar de una convención (H:326-344).
 */
import { desplazarDia } from "../store/clock";

export interface SelectorDiaOperativaProps {
  /** Día operativo seleccionado (YYYY-MM-DD): el valor que el navegador mueve. */
  fechaOperativa: string;
  /**
   * HOY como referencia de SOLO LECTURA (tarea 9.2): la prop `fechaOperativaHoy`
   * de `App`, NUNCA una lectura fresca del reloj. Es el tope superior del
   * selector y el punto donde la flecha «siguiente» se detiene.
   */
  hoy: string;
  /** `true` mientras un cambio de día está en vuelo: deja los tres controles inoperativos. */
  disabled: boolean;
  /** Seam del navegador: pide cargar ese día; la raíz decide si el cambio resuelve. */
  onSeleccionar(fechaOperativa: string): void;
}

export function SelectorDiaOperativa({
  fechaOperativa,
  hoy,
  disabled,
  onSeleccionar,
}: SelectorDiaOperativaProps) {
  const anterior = desplazarDia(fechaOperativa, -1);
  const siguiente = desplazarDia(fechaOperativa, +1);
  const esHoy = fechaOperativa === hoy;
  return (
    <nav className="selector-dia" aria-label="Día operativo">
      <button
        type="button"
        onClick={() => onSeleccionar(anterior)}
        disabled={disabled}
        aria-label="Día operativo anterior"
      >
        <span aria-hidden="true">←</span>
      </button>

      <label className="selector-dia__campo">
        <span>Fecha operativa</span>
        <input
          type="date"
          value={fechaOperativa}
          max={hoy}
          disabled={disabled}
          onChange={(e) => e.target.value && onSeleccionar(e.target.value)}
        />
      </label>

      <button
        type="button"
        onClick={() => onSeleccionar(siguiente)}
        disabled={disabled || esHoy}
        aria-label="Día operativo siguiente"
      >
        <span aria-hidden="true">→</span>
      </button>
    </nav>
  );
}
