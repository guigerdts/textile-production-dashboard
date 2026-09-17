/**
 * Seam de dominio — ticket 01 (orden de producción y progreso).
 * Funciones PURAS: sin imports de UI, API ni persistencia.
 * Reglas de redondeo: nunca fracciones de golpe ni de toalla (ceil).
 */
import type { LecturaContador, Orden } from "./types";

/** 1 golpe imprime 3 toallas (máquina de estampado, CONTEXT.md). */
export const TOALLAS_POR_GOLPE = 3;

export function golpesParaUnidades(unidades: number): number {
  return Math.ceil(unidades / TOALLAS_POR_GOLPE);
}

export function unidadesParaGolpes(golpes: number): number {
  return golpes * TOALLAS_POR_GOLPE;
}

/**
 * Orden exacto de cálculo de la proyección operativa:
 * 1) unidadesObjetivo = ceil(unidadesSolicitadas × (1 + porcentaje2da))
 * 2) golpesRequeridos = ceil(unidadesObjetivo / 3)
 */
export function unidadesObjetivoCon2da(solicitadas: number, pct2da = 0): number {
  return Math.ceil(solicitadas * (1 + pct2da));
}

export function golpesRequeridosOrden(solicitadas: number, pct2da = 0): number {
  return golpesParaUnidades(unidadesObjetivoCon2da(solicitadas, pct2da));
}

export function validarPct2da(pct: number): string[] {
  const errores: string[] = [];
  if (Number.isNaN(pct) || pct < 0) {
    errores.push("porcentaje2da no puede ser negativo");
  }
  if (pct >= 1) {
    errores.push("porcentaje2da debe ser menor a 1 (100%)");
  }
  return errores;
}

/**
 * Invariante de la proyección de segunda para una orden:
 * - aplicaSegunda = false  -> porcentaje2da DEBE ser 0.
 * - aplicaSegunda = true   -> 0 <= porcentaje2da < 1 (5% es sugerido, no obligatorio).
 */
export function validarProyeccionSegunda(aplicaSegunda: boolean, porcentaje2da: number): string[] {
  const errores: string[] = [];
  if (!aplicaSegunda && porcentaje2da !== 0) {
    errores.push("si aplicaSegunda es false, porcentaje2da debe ser 0");
  }
  if (aplicaSegunda) {
    errores.push(...validarPct2da(porcentaje2da));
  }
  return errores;
}

export function validarLecturaValor(valor: number): string[] {
  const errores: string[] = [];
  if (!Number.isInteger(valor) || valor < 0) {
    errores.push("la lectura del contador debe ser un número entero mayor o igual a 0");
  }
  return errores;
}

function validarOperatorName(operatorName: string): string[] {
  const errores: string[] = [];
  if (!operatorName || operatorName.trim() === "") {
    errores.push("operatorName es obligatorio");
  }
  return errores;
}

export interface IniciarProduccionInput {
  operatorName: string;
  /** Lectura absoluta inicial del contador. Establece la base. */
  lecturaInicial: number;
  timestamp: string;
}

export interface ResultadoDominio<T> {
  orden?: T;
  errores: string[];
}

/**
 * Inicia la producción validando y registrando CONJUNTAMENTE:
 * operator_name, lectura inicial absoluta (base), timestamp y estado in_production.
 * No existe una orden iniciada sin contador base.
 */
export function iniciarProduccion(
  orden: Orden,
  input: IniciarProduccionInput,
): ResultadoDominio<Orden> {
  const errores: string[] = [];
  if (orden.estado !== "available") {
    errores.push("solo se puede iniciar una orden disponible");
  }
  errores.push(...validarProyeccionSegunda(orden.aplicaSegunda, orden.porcentaje2da));
  errores.push(...validarOperatorName(input.operatorName));
  errores.push(...validarLecturaValor(input.lecturaInicial));
  if (errores.length > 0) {
    return { orden, errores };
  }
  const base: LecturaContador = {
    valor: input.lecturaInicial,
    timestamp: input.timestamp,
    deltaGolpes: 0,
  };
  return {
    orden: {
      ...orden,
      estado: "in_production",
      operatorName: input.operatorName.trim(),
      contadorBase: input.lecturaInicial,
      iniciadaEn: input.timestamp,
      lecturas: [base],
    },
    errores,
  };
}

/** Producción = suma de deltas entre lecturas consecutivas. La base (primera) aporta 0. */
export function golpesProducidosDesdeLecturas(lecturas: LecturaContador[]): number {
  return lecturas.reduce((acc, lec) => acc + lec.deltaGolpes, 0);
}

export interface RegistrarLecturaInput {
  valor: number;
  timestamp: string;
}

export interface ResultadoLectura extends ResultadoDominio<Orden> {
  sinIncremento?: boolean;
}

export function registrarLectura(
  orden: Orden,
  input: RegistrarLecturaInput,
): ResultadoLectura {
  const errores: string[] = [];
  if (orden.estado !== "in_production") {
    errores.push("solo se registran lecturas en una orden en producción");
    return { orden, errores };
  }
  if (orden.contadorBase === undefined || orden.lecturas.length === 0) {
    errores.push("la orden no tiene contador base; debe iniciarse primero");
    return { orden, errores };
  }
  errores.push(...validarLecturaValor(input.valor));
  if (errores.length > 0) {
    return { orden, errores };
  }

  const ultima = orden.lecturas[orden.lecturas.length - 1];
  if (input.valor < ultima.valor) {
    errores.push("el contador no puede retroceder");
    return { orden, errores };
  }

  const delta = input.valor - ultima.valor;
  const lectura: LecturaContador = {
    valor: input.valor,
    timestamp: input.timestamp,
    deltaGolpes: delta,
  };
  return {
    orden: { ...orden, lecturas: [...orden.lecturas, lectura] },
    errores,
    sinIncremento: delta === 0,
  };
}

/**
 * Finalización: válida incluso con cero golpes (queda registrado).
 * Unidireccional: disponible -> en producción -> finalizada. No se reinicia.
 */
export function finalizarProduccion(
  orden: Orden,
  timestamp: string,
): ResultadoDominio<Orden> {
  const errores: string[] = [];
  if (orden.estado === "finished") {
    errores.push("la orden ya está finalizada");
    return { orden, errores };
  }
  if (orden.estado !== "in_production") {
    errores.push("solo se finaliza una orden en producción");
    return { orden, errores };
  }
  return {
    orden: { ...orden, estado: "finished", finalizadaEn: timestamp },
    errores,
  };
}

export interface ProgresoProduccion {
  golpesProducidos: number;
  unidadesProducidas: number;
  unidadesObjetivo: number;
  unidadesRestantes: number;
  golpesRequeridos: number;
  golpesRestantes: number;
  pctCompletado: number;
}

/**
 * Progreso sobre el objetivo operativo (incluye %2da estimado).
 * unidadesProducidas siempre = golpes × 3.
 */
export function calcularProgreso(
  golpesProducidos: number,
  unidadesSolicitadas: number,
  pct2da = 0,
): ProgresoProduccion {
  const unidadesProducidas = unidadesParaGolpes(golpesProducidos);
  const unidadesObjetivo = unidadesObjetivoCon2da(unidadesSolicitadas, pct2da);
  const golpesRequeridos = golpesRequeridosOrden(unidadesSolicitadas, pct2da);
  return {
    golpesProducidos,
    unidadesProducidas,
    unidadesObjetivo,
    unidadesRestantes: Math.max(0, unidadesObjetivo - unidadesProducidas),
    golpesRequeridos,
    golpesRestantes: Math.max(0, golpesRequeridos - golpesProducidos),
    pctCompletado: unidadesObjetivo === 0 ? 0 : unidadesProducidas / unidadesObjetivo,
  };
}