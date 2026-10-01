import { useEffect, useMemo, useState } from "react";
import type {
  ActividadAbierta,
  ActividadPlanificada,
  Dano,
  DanoAbierto,
  InspeccionTela,
  JornadaTurno,
  LecturaContador,
  Mantenimiento,
  MantenimientoAbierto,
  Orden,
  Parada,
  ResumenTiempoTurno,
  TipoActividadPlanificada,
} from "./domain/types";
import type { IOrderRepository, ILecturaGolpeRepository } from "./store/repository";
import type { IParadaRepository } from "./store/paradasRepository";
import { InMemoryParadaRepository } from "./store/inMemoryParadasRepository";
import type { IActividadPlanificadaRepository } from "./store/actividadesRepository";
import { InMemoryActividadPlanificadaRepository } from "./store/inMemoryActividadesRepository";
import type { IJornadaRepository } from "./store/jornadaRepository";
import { InMemoryJornadaRepository } from "./store/inMemoryJornadaRepository";
import type { IDanoRepository } from "./store/danosRepository";
import { InMemoryDanoRepository } from "./store/inMemoryDanosRepository";
import type { IInspeccionRepository } from "./store/inspeccionRepository";
import { InMemoryInspeccionRepository } from "./store/inMemoryInspeccionRepository";
import type { IMantenimientoRepository } from "./store/mantenimientoRepository";
import { InMemoryMantenimientoRepository } from "./store/inMemoryMantenimientoRepository";
import { fechaOperativaHoy } from "./store/fixtures";
import { componerOrdenConLecturas, type RecoveryState } from "./store/sqlite/recovery";
import {
  finalizarProduccion,
  iniciarProduccion,
  registrarLectura,
} from "./domain/calculations";
import {
  cerrarParada,
  duracionAcumulada,
  getCausaParadaPorId,
  paradaAbierta,
  registrarParada,
  validarFinalizacionConParadas,
  validarLecturaConParadas,
} from "./domain/paradas";
import type { RegistrarParadaInput } from "./domain/paradas";
import { comenzarActividad, finalizarActividad } from "./domain/actividades";
import type { RegistrarActividadInput } from "./domain/actividades";
import { cerrarDano, danoAbierto, registrarDano } from "./domain/danos";
import type { RegistrarDanoInput } from "./domain/danos";
import { registrarMantenimiento, cerrarMantenimiento, mantenimientoAbierto } from "./domain/mantenimiento";
import type { RegistrarMantenimientoInput } from "./domain/mantenimiento";
import {
  registrarAutorizacionGerencia,
  registrarDevolucion,
  registrarInspeccion,
} from "./domain/inspeccionTela";
import type {
  RegistrarAutorizacionInput,
  RegistrarDevolucionInput,
  RegistrarInspeccionInput,
} from "./domain/inspeccionTela";
import { proyeccionSegundaDeOrden } from "./domain/calidad";
import { jornadaDefault, resumenTiempoTurno } from "./domain/tiempo";
import { EmptyDay } from "./ui/EmptyDay";
import { DashboardHome } from "./ui/DashboardHome";
import { OrderAvailable } from "./ui/OrderAvailable";
import { OrderFinished } from "./ui/OrderFinished";
import { OrderInProduction, type ResultadoRegistroLectura } from "./ui/OrderInProduction";
import "./App.css";

interface AppProps {
  repository: IOrderRepository;
  /** Repositorio de paradas; default vacío para no interferir con el flujo de órdenes (los fixtures son para pruebas del repo). */
  paradaRepository?: IParadaRepository;
  /** Repositorio de actividades planificadas; default vacío (los fixtures son para pruebas del repo). */
  actividadRepository?: IActividadPlanificadaRepository;
  /** Repositorio de jornada del turno; default vacío → jornada 07:00–17:00 por fecha operativa. */
  jornadaRepository?: IJornadaRepository;
  /** Repositorio de daños; default vacío (los fixtures son para pruebas del repo). */
  danoRepository?: IDanoRepository;
  /** Repositorio de inspecciones de tela (ticket 07); default vacío (los fixtures son para pruebas del repo). */
  inspeccionRepository?: IInspeccionRepository;
  /** Repositorio de mantenimiento (ticket 08); default vacío (los fixtures son para pruebas del repo). */
  mantenimientoRepository?: IMantenimientoRepository;
  /**
   * Repositorio de lecturas de golpe (ticket 10.8). Cuando está presente (producción)
   * cada lectura real se persiste con la mecánica aprobada de dos fases
   * (reserveSequence + completeLecture) y, al montar, las lecturas ya persistidas se
   * componen sobre la orden. Cuando está ausente se conserva el comportamiento previo
   * (solo saveOrder; las lecturas viven dentro de la orden en memoria).
   */
  lecturaRepository?: ILecturaGolpeRepository;
  /**
   * Estado YA resuelto por recovery (ticket 10.7/10.8) para la fecha operativa: siembra
   * orden y jornada. App NUNCA recibe promesas ni calcula recovery.
   */
  estadoInicial?: RecoveryState;
  /** Fecha operativa consultada. En runtime se usa el día de hoy; en pruebas se inyecta (sin selector en la UI). */
  hoy?: string;
}

function App({
  repository,
  paradaRepository: paradaRepositoryProp,
  actividadRepository: actividadRepositoryProp,
  jornadaRepository: jornadaRepositoryProp,
  danoRepository: danoRepositoryProp,
  inspeccionRepository: inspeccionRepositoryProp,
  mantenimientoRepository: mantenimientoRepositoryProp,
  lecturaRepository,
  estadoInicial,
  hoy = fechaOperativaHoy(),
}: AppProps) {
  // Semilla desde el estado recuperado (10.8): el loader de montaje vuelve a leer los
  // mismos repositorios (relectura idempotente, misma data) y no cambia el resultado.
  // Phase 14.1 (D2h): las cinco listas operativas se siembran incondicionalmente desde
  // `estadoInicial` — el primer paint muestra la data recuperada sin parpadeo y el
  // loader de montaje la reemplaza por la relectura fresca del repositorio.
  const [orden, setOrden] = useState<Orden | undefined>(() =>
    estadoInicial?.orden
      ? componerOrdenConLecturas(estadoInicial.orden, estadoInicial.lecturas)
      : undefined,
  );
  const [paradas, setParadas] = useState<Parada[]>(() => estadoInicial?.paradas ?? []);
  const [actividades, setActividades] = useState<ActividadPlanificada[]>(
    () => estadoInicial?.actividades ?? [],
  );
  const [danos, setDanos] = useState<Dano[]>(() => estadoInicial?.danos ?? []);
  const [mantenimientos, setMantenimientos] = useState<Mantenimiento[]>(
    () => estadoInicial?.mantenimientos ?? [],
  );
  const [inspecciones, setInspecciones] = useState<InspeccionTela[]>(
    () => estadoInicial?.inspecciones ?? [],
  );
  const [jornada, setJornada] = useState<JornadaTurno>(
    () => estadoInicial?.jornada ?? jornadaDefault(hoy),
  );
  // Phase 14.2: los tres valores que antes se derivaban del puerto en el render body
  // viven ahora en estado. La semilla es coherente con los arrays de daños/mantenimientos
  // recuperados; tras cada mutación los re-leen los loaders de montaje o `recargar*()`.
  const [danoAbiertoDeMaquina, setDanoAbiertoDeMaquina] = useState<DanoAbierto | null>(
    () => danoAbierto(estadoInicial?.danos ?? [], "M1"),
  );
  const [mantenimientoAbiertoDeMaquina, setMantenimientoAbiertoDeMaquina] =
    useState<MantenimientoAbierto | null>(() =>
      mantenimientoAbierto(estadoInicial?.mantenimientos ?? [], "M1"),
    );
  const [danosDeOrden, setDanosDeOrden] = useState<Dano[]>(() =>
    (estadoInicial?.danos ?? []).filter((d) => d.ordenId === estadoInicial?.orden?.id),
  );

  // Referencia estable para los defaults: sin esto, los useEffect de paradas/actividades
  // re-dispararían en cada render (nueva instancia cada vez) -> loop infinito.
  const paradaRepository = useMemo(
    () => paradaRepositoryProp ?? new InMemoryParadaRepository([]),
    [paradaRepositoryProp],
  );
  const actividadRepository = useMemo(
    () => actividadRepositoryProp ?? new InMemoryActividadPlanificadaRepository([]),
    [actividadRepositoryProp],
  );
  const jornadaRepository = useMemo(
    () => jornadaRepositoryProp ?? new InMemoryJornadaRepository([]),
    [jornadaRepositoryProp],
  );
  const danoRepository = useMemo(
    () => danoRepositoryProp ?? new InMemoryDanoRepository([]),
    [danoRepositoryProp],
  );
  const inspeccionRepository = useMemo(
    () => inspeccionRepositoryProp ?? new InMemoryInspeccionRepository([]),
    [inspeccionRepositoryProp],
  );
  const mantenimientoRepository = useMemo(
    () => mantenimientoRepositoryProp ?? new InMemoryMantenimientoRepository([]),
    [mantenimientoRepositoryProp],
  );

  useEffect(() => {
    let cancelled = false;
    async function cargarOrden() {
      const ordenCargada = await repository.getOrderByFechaOperativa(hoy);
      if (cancelled) return;
      // Con lecturaRepository presente las lecturas persistidas son parte de la
      // orden: el repositorio de órdenes NUNCA las consulta (10.4/10.5), así que se
      // componen aquí (misma derivación que mapOrdenRow). Sin ese repositorio no hay
      // lecturas que componer y el comportamiento previo se mantiene intacto.
      if (ordenCargada && lecturaRepository) {
        const lecturas = await lecturaRepository.getLecturasByOrden(ordenCargada.id);
        if (cancelled) return;
        setOrden(componerOrdenConLecturas(ordenCargada, lecturas));
        return;
      }
      setOrden(ordenCargada);
    }
    cargarOrden();
    return () => {
      cancelled = true;
    };
  }, [repository, lecturaRepository, hoy]);

  useEffect(() => {
    let cancelled = false;
    async function cargarParadas() {
      const paradasCargadas = await paradaRepository.listarPorMaquina("M1");
      if (!cancelled) setParadas(paradasCargadas);
    }
    cargarParadas();
    return () => {
      cancelled = true;
    };
  }, [paradaRepository]);

  useEffect(() => {
    let cancelled = false;
    async function cargarActividades() {
      const actividadesCargadas = await actividadRepository.listarPorMaquina("M1");
      if (!cancelled) setActividades(actividadesCargadas);
    }
    cargarActividades();
    return () => {
      cancelled = true;
    };
  }, [actividadRepository]);

  useEffect(() => {
    let cancelled = false;
    async function cargarJornada() {
      const jornadaCargada = await jornadaRepository.obtenerParaFecha(hoy);
      if (!cancelled) setJornada(jornadaCargada);
    }
    cargarJornada();
    return () => {
      cancelled = true;
    };
  }, [jornadaRepository, hoy]);

  useEffect(() => {
    // Phase 14.1: el loader de daños re-lee los tres valores (lista de la máquina,
    // abierto de la máquina y daños de la orden current) — los mismos que siembra el
    // seed, pero frescos del repositorio. `orden?.id` hace que cambiar de orden recargue.
    let cancelled = false;
    async function cargarDanos() {
      const [danosCargados, abierto, deOrden] = await Promise.all([
        danoRepository.listarPorMaquina("M1"),
        danoRepository.getDanoAbierto("M1"),
        orden ? danoRepository.listarPorOrden(orden.id) : Promise.resolve([]),
      ]);
      if (cancelled) return;
      setDanos(danosCargados);
      setDanoAbiertoDeMaquina(abierto);
      setDanosDeOrden(deOrden);
    }
    cargarDanos();
    return () => {
      cancelled = true;
    };
  }, [danoRepository, orden?.id]);

  useEffect(() => {
    // Phase 14.1: lista y abierto de mantenimientos se re-leen juntos; el abierto
    // vive en estado (14.2) y este loader es quien lo refresca al montar.
    let cancelled = false;
    async function cargarMantenimientos() {
      const [deMaquina, abierto] = await Promise.all([
        mantenimientoRepository.listarPorMaquina("M1"),
        mantenimientoRepository.getMantenimientoAbierto("M1"),
      ]);
      if (cancelled) return;
      setMantenimientos(deMaquina);
      setMantenimientoAbiertoDeMaquina(abierto);
    }
    cargarMantenimientos();
    return () => {
      cancelled = true;
    };
  }, [mantenimientoRepository]);

  useEffect(() => {
    // La inspección siempre pertenece a su orden: se recarga al cambiar la orden.
    let cancelled = false;
    async function cargarInspecciones() {
      if (orden) {
        const cargadas = await inspeccionRepository.listarPorOrden(orden.id);
        if (!cancelled) setInspecciones(cargadas);
      } else if (!cancelled) {
        setInspecciones([]);
      }
    }
    cargarInspecciones();
    return () => {
      cancelled = true;
    };
  }, [inspeccionRepository, orden?.id]);

  /**
   * Phase 14.3 (D2i): un helper de re-siembra por dominio, la ÚNICA vía por la que los
   * estados operativos cambian después de una mutación. Convertir el puerto en la
   * fuente de verdad exige que "refrescar tras escribir" sea una sola forma para los
   * cinco dominios; tres sitios ad-hoc son exactamente cómo un valor derivado (p. ej.
   * el daño abierto) queda viejo mientras su lista ya está fresca.
   */
  async function recargarParadas(): Promise<void> {
    setParadas(await paradaRepository.listarPorMaquina("M1"));
  }

  async function recargarActividades(): Promise<void> {
    setActividades(await actividadRepository.listarPorMaquina("M1"));
  }

  async function recargarDanos(): Promise<void> {
    const [danosDeMaquina, abierto, deOrden] = await Promise.all([
      danoRepository.listarPorMaquina("M1"),
      danoRepository.getDanoAbierto("M1"),
      orden ? danoRepository.listarPorOrden(orden.id) : Promise.resolve([]),
    ]);
    setDanos(danosDeMaquina);
    setDanoAbiertoDeMaquina(abierto);
    setDanosDeOrden(deOrden);
  }

  async function recargarMantenimientos(): Promise<void> {
    const [deMaquina, abierto] = await Promise.all([
      mantenimientoRepository.listarPorMaquina("M1"),
      mantenimientoRepository.getMantenimientoAbierto("M1"),
    ]);
    setMantenimientos(deMaquina);
    setMantenimientoAbiertoDeMaquina(abierto);
  }

  async function recargarInspecciones(): Promise<void> {
    const cargadas = orden ? await inspeccionRepository.listarPorOrden(orden.id) : [];
    setInspecciones(cargadas);
  }

  /**
   * Persistencia de una operación del operario que dejó una lectura real (10.8).
   * Orden de escritura: primero la lectura (reserva + completion), después el
   * progreso de la fila `orden`. No existe transacción cruzada entre tablas
   * (C3/10.3: atomicidad de una sola sentencia), así que un fallo intermedio
   * deja la lectura ya persistida como durable — recovery la incluirá; el error
   * se propaga al operador, nunca se oculta.
   * Sin `lecturaRepository` (ruta legacy/pruebas) se conserva el saveOrder de siempre.
   */
  async function persistirOrdenConLectura(ordenActualizada: Orden, lectura: LecturaContador): Promise<void> {
    if (lecturaRepository) {
      // lectureId por intención del operario: es la clave de retry/idempotencia
      // de la reserva; una intención abandonada queda 'reserved' y se excluye
      // del recovery (puede dejar huecos de secuencia, que se preservan).
      const lectureId = crypto.randomUUID();
      await lecturaRepository.reserveSequence(ordenActualizada.id, lectureId);
      await lecturaRepository.completeLecture(lectureId, lectura.valor, lectura.timestamp);
    }
    await repository.saveOrder(ordenActualizada);
  }

  /** Única vía available -> in_production: dominio + repositorio; React no duplica reglas. */
  async function handleIniciar(operatorName: string, lecturaInicial: number): Promise<string[]> {
    if (!orden || orden.estado !== "available") {
      return ["solo se puede iniciar una orden disponible"];
    }
    const resultado = iniciarProduccion(orden, {
      operatorName,
      lecturaInicial,
      timestamp: new Date().toISOString(),
    });
    if (resultado.errores.length > 0) {
      return resultado.errores;
    }
    if (!resultado.orden) {
      return ["no se pudo iniciar la producción"];
    }
    try {
      // La lectura base es la primera del dominio: es la fuente de la que
      // (mapOrdenRow) derivan luego iniciadaEn/contadorBase tras un reinicio.
      await persistirOrdenConLectura(resultado.orden, resultado.orden.lecturas[0]);
    } catch (error) {
      return [error instanceof Error ? error.message : "no se pudo guardar la orden"];
    }
    setOrden(resultado.orden);
    return [];
  }

  /** Única vía in_production -> nueva lectura: dominio + repositorio; React no duplica reglas. */
  async function handleRegistrarLectura(valor: number): Promise<ResultadoRegistroLectura> {
    if (!orden || orden.estado !== "in_production") {
      return { errores: ["solo se registran lecturas en una orden en producción"], sinIncremento: false };
    }
    // Regla de paradas: una parada abierta de la orden bloquea lecturas (dominio, no UI).
    const bloqueosParada = validarLecturaConParadas(paradas, orden.id);
    if (bloqueosParada.length > 0) {
      return { errores: bloqueosParada, sinIncremento: false };
    }
    const resultado = registrarLectura(orden, {
      valor,
      timestamp: new Date().toISOString(),
    });
    if (resultado.errores.length > 0) {
      return { errores: resultado.errores, sinIncremento: false };
    }
    if (!resultado.orden) {
      return { errores: ["no se pudo registrar la lectura"], sinIncremento: false };
    }
    try {
      // La lectura nueva es la última del dominio: mismo valor y timestamp
      // exactos que devuelve la completion (nunca un timestamp distinto).
      await persistirOrdenConLectura(
        resultado.orden,
        resultado.orden.lecturas[resultado.orden.lecturas.length - 1],
      );
    } catch (error) {
      return {
        errores: [error instanceof Error ? error.message : "no se pudo guardar la lectura"],
        sinIncremento: false,
      };
    }
    setOrden(resultado.orden);
    return { errores: [], sinIncremento: resultado.sinIncremento ?? false };
  }

  /** Única vía in_production -> finished: dominio + repositorio; React no duplica reglas. */
  async function handleFinalizar(): Promise<string[]> {
    if (!orden || orden.estado !== "in_production") {
      return ["solo se finaliza una orden en producción"];
    }
    // Regla de paradas: una parada abierta de la orden bloquea la finalización (dominio, no UI).
    const bloqueosParada = validarFinalizacionConParadas(paradas, orden.id);
    if (bloqueosParada.length > 0) {
      return bloqueosParada;
    }
    const resultado = finalizarProduccion(orden, new Date().toISOString());
    if (resultado.errores.length > 0) {
      return resultado.errores;
    }
    if (!resultado.orden) {
      return ["no se pudo finalizar la producción"];
    }
    try {
      await repository.saveOrder(resultado.orden);
    } catch (error) {
      return [error instanceof Error ? error.message : "no se pudo guardar la orden"];
    }
    setOrden(resultado.orden);
    return [];
  }

  /** Única vía registrar parada: dominio + repositorio; React no duplica reglas. */
  async function handleRegistrarParada(input: RegistrarParadaInput): Promise<string[]> {
    if (!orden || orden.estado !== "in_production") {
      return ["solo se registran paradas en una orden en producción"];
    }
    const resultado = registrarParada(paradas, input);
    if (resultado.errores.length > 0) {
      return resultado.errores;
    }
    if (!resultado.parada) {
      return ["no se pudo registrar la parada"];
    }
    try {
      await paradaRepository.insertParada(resultado.parada);
    } catch (error) {
      return [error instanceof Error ? error.message : "no se pudo guardar la parada"];
    }
    await recargarParadas();
    return [];
  }

  /** Única vía cerrar parada: dominio + repositorio; React no duplica reglas. */
  async function handleCerrarParada(): Promise<string[]> {
    if (!orden) {
      return ["no hay orden activa"];
    }
    const abierta = await paradaRepository.getParadaAbierta("M1", orden.id);
    if (!abierta) {
      return ["no hay una parada abierta para cerrar"];
    }
    const resultado = cerrarParada(abierta, new Date().toISOString());
    if (resultado.errores.length > 0) {
      return resultado.errores;
    }
    if (!resultado.parada) {
      return ["no se pudo cerrar la parada"];
    }
    try {
      await paradaRepository.updateParada(resultado.parada);
    } catch (error) {
      return [error instanceof Error ? error.message : "no se pudo actualizar la parada"];
    }
    await recargarParadas();
    return [];
  }

  /** Única vía registrar actividad planificada: dominio + repositorio; React no duplica reglas. */
  async function handleRegistrarActividad(
    input: RegistrarActividadInput,
  ): Promise<string[]> {
    const resultado = comenzarActividad(actividades, input);
    if (resultado.errores.length > 0) {
      return resultado.errores;
    }
    if (!resultado.actividad) {
      return ["no se pudo registrar la actividad"];
    }
    try {
      await actividadRepository.insertActividad(resultado.actividad);
    } catch (error) {
      return [error instanceof Error ? error.message : "no se pudo guardar la actividad"];
    }
    await recargarActividades();
    return [];
  }

  /** Única vía cerrar actividad: dominio + repositorio; React no duplica reglas. */
  async function handleCerrarActividad(
    tipo: TipoActividadPlanificada,
  ): Promise<string[]> {
    const abierta = await actividadRepository.getActividadAbierta("M1", tipo);
    if (!abierta) {
      return ["no hay una actividad abierta para cerrar"];
    }
    const resultado = finalizarActividad(abierta, new Date().toISOString());
    if (resultado.errores.length > 0) {
      return resultado.errores;
    }
    if (!resultado.actividad) {
      return ["no se pudo cerrar la actividad"];
    }
    try {
      await actividadRepository.updateActividad(resultado.actividad);
    } catch (error) {
      return [error instanceof Error ? error.message : "no se pudo actualizar la actividad"];
    }
    await recargarActividades();
    return [];
  }

  /** Única vía editar el fin de jornada (overtime): repositorio valida; React no duplica reglas. */
  async function handleCambiarFinJornada(fin: string): Promise<string[]> {
    const finIso = `${hoy}T${fin}:00.000Z`;
    const nuevaJornada: JornadaTurno = { inicio: jornada.inicio, fin: finIso };
    try {
      await jornadaRepository.guardarJornada(hoy, nuevaJornada);
      setJornada(nuevaJornada);
      return [];
    } catch (error) {
      // La validación del dominio (fin > inicio) llega como error del repositorio.
      return [error instanceof Error ? error.message : "no se pudo guardar la jornada"];
    }
  }

  /** Única vía registrar daño: dominio + repositorio; React no duplica reglas. */
  async function handleRegistrarDano(input: RegistrarDanoInput): Promise<string[]> {
    // Phase 14.5 — Approach A (D2i): un solo `await` al puerto con la parada
    // vinculada (los datos más frescos posibles), y el closure que recibe el
    // dominio queda síncrono. `registrarDano` siempre recibe `Parada | undefined`,
    // nunca una Promise. Un id colgado (la parada ya no existe) falla con el
    // mensaje propio del dominio y el insert nunca se intenta: un error de FK no
    // puede aparecer aquí. El fallback sobre `paradas` (estado) cubre la parada
    // que el operario acaba de registrar y aún no se re-lee del puerto.
    const vinculada = input.paradaId
      ? await paradaRepository.obtenerPorId(input.paradaId)
      : undefined;
    const resultado = registrarDano(danos, input, (id) =>
      id === vinculada?.id ? vinculada : paradas.find((p) => p.id === id),
    );
    if (resultado.errores.length > 0) {
      return resultado.errores;
    }
    if (!resultado.dano) {
      return ["no se pudo registrar el daño"];
    }
    try {
      await danoRepository.insertDano(resultado.dano);
    } catch (error) {
      return [error instanceof Error ? error.message : "no se pudo guardar el daño"];
    }
    await recargarDanos();
    return [];
  }

  /** Única vía cerrar daño: dominio + repositorio; React no duplica reglas. */
  async function handleCerrarDano(fin: string, solucionAplicada: string): Promise<string[]> {
    const abierto = await danoRepository.getDanoAbierto("M1");
    if (!abierto) {
      return ["no hay un daño abierto para cerrar"];
    }
    const resultado = cerrarDano(abierto, fin, solucionAplicada);
    if (resultado.errores.length > 0) {
      return resultado.errores;
    }
    if (!resultado.dano) {
      return ["no se pudo cerrar el daño"];
    }
    try {
      await danoRepository.updateDano(resultado.dano);
    } catch (error) {
      return [error instanceof Error ? error.message : "no se pudo actualizar el daño"];
    }
    await recargarDanos();
    return [];
  }

  /** Única vía registrar inspección de tela (ticket 07): dominio + repositorio; React no duplica reglas. */
  async function handleRegistrarInspeccion(input: RegistrarInspeccionInput): Promise<string[]> {
    if (!orden) {
      return ["la inspección de tela debe estar asociada a una orden de producción"];
    }
    const resultado = registrarInspeccion(orden, input);
    if (resultado.errores.length > 0) {
      return resultado.errores;
    }
    if (!resultado.inspeccion) {
      return ["no se pudo registrar la inspección"];
    }
    try {
      await inspeccionRepository.insertInspeccion(resultado.inspeccion);
    } catch (error) {
      return [error instanceof Error ? error.message : "no se pudo guardar la inspección"];
    }
    await recargarInspecciones();
    return [];
  }

  /** Única vía resolver una inspección con devolución (ticket 07): dominio + repositorio. */
  async function handleDevolverInspeccion(
    inspeccionId: string,
    input: RegistrarDevolucionInput,
  ): Promise<string[]> {
    if (!orden) {
      return ["la inspección de tela debe estar asociada a una orden de producción"];
    }
    const existente = await inspeccionRepository.obtenerPorId(inspeccionId);
    if (!existente) {
      return ["la inspección ya no existe"];
    }
    // El dominio valida que la producción derivada sea 0 (pre-impresión); la UI solo decide visibilidad.
    const resultado = registrarDevolucion(orden, existente, input);
    if (resultado.errores.length > 0) {
      return resultado.errores;
    }
    if (!resultado.inspeccion) {
      return ["no se pudo registrar la devolución"];
    }
    try {
      await inspeccionRepository.updateInspeccion(resultado.inspeccion);
    } catch (error) {
      return [error instanceof Error ? error.message : "no se pudo actualizar la inspección"];
    }
    await recargarInspecciones();
    return [];
  }

  /** Única vía resolver una inspección con autorización de gerencia (ticket 07): dominio + repositorio. */
  async function handleAutorizarInspeccion(
    inspeccionId: string,
    input: RegistrarAutorizacionInput,
  ): Promise<string[]> {
    if (!orden) {
      return ["la inspección de tela debe estar asociada a una orden de producción"];
    }
    const existente = await inspeccionRepository.obtenerPorId(inspeccionId);
    if (!existente) {
      return ["la inspección ya no existe"];
    }
    const resultado = registrarAutorizacionGerencia(existente, input);
    if (resultado.errores.length > 0) {
      return resultado.errores;
    }
    if (!resultado.inspeccion) {
      return ["no se pudo registrar la autorización"];
    }
    try {
      await inspeccionRepository.updateInspeccion(resultado.inspeccion);
    } catch (error) {
      return [error instanceof Error ? error.message : "no se pudo actualizar la inspección"];
    }
    await recargarInspecciones();
    return [];
  }

  /** Única vía registrar mantenimiento: dominio + repositorio; React no duplica reglas. */
  async function handleRegistrarMantenimiento(
    input: RegistrarMantenimientoInput,
  ): Promise<string[]> {
    // Phase 14.5 — Approach A (D2i): idéntico a handleRegistrarDano; un solo await
    // al puerto para el daño vinculado y closure síncrono. El dominio recibe
    // `Dano | undefined`, nunca una Promise; un id colgado falla con el mensaje
    // propio del dominio sin intentar el insert.
    const vinculado = input.danoId
      ? await danoRepository.obtenerPorId(input.danoId)
      : undefined;
    const resultado = registrarMantenimiento(mantenimientos, input, (id) =>
      id === vinculado?.id ? vinculado : danos.find((d) => d.id === id),
    );
    if (resultado.errores.length > 0) {
      return resultado.errores;
    }
    if (!resultado.mantenimiento) {
      return ["no se pudo registrar el mantenimiento"];
    }
    try {
      await mantenimientoRepository.insertMantenimiento(resultado.mantenimiento);
    } catch (error) {
      return [error instanceof Error ? error.message : "no se pudo guardar el mantenimiento"];
    }
    await recargarMantenimientos();
    return [];
  }

  /** Única vía cerrar mantenimiento: dominio + repositorio; React no duplica reglas. */
  async function handleCerrarMantenimiento(
    fin: string,
    queSeRevisoReparo: string,
  ): Promise<string[]> {
    const abierto = await mantenimientoRepository.getMantenimientoAbierto("M1");
    if (!abierto) {
      return ["no hay un mantenimiento abierto para cerrar"];
    }
    const resultado = cerrarMantenimiento(abierto, fin, queSeRevisoReparo);
    if (resultado.errores.length > 0) {
      return resultado.errores;
    }
    if (!resultado.mantenimiento) {
      return ["no se pudo cerrar el mantenimiento"];
    }
    try {
      await mantenimientoRepository.updateMantenimiento(resultado.mantenimiento);
    } catch (error) {
      return [error instanceof Error ? error.message : "no se pudo actualizar el mantenimiento"];
    }
    await recargarMantenimientos();
    return [];
  }

  /** Resumen del turno derivado por dominio (NUNCA entrada manual). Instante de consulta = ahora. */
  const resultadoResumen = resumenTiempoTurno({
    jornada,
    actividades,
    paradas,
    instanteConsulta: new Date().toISOString(),
  });
  // La jornada en estado SIEMPRE es válida (default o guardada validada): el resumen existe.
  const resumenTiempo: ResumenTiempoTurno = resultadoResumen.resumen ?? {
    totalDisponible: 0,
    planificado: 0,
    incidencias: 0,
    noProductivoTotal: 0,
    productivo: 0,
  };

  /** Paradas de la orden actual + parada abierta derivadas del estado (dominio puro). */
  const paradasDeOrden = paradas.filter((p) => p.ordenId === orden?.id);
  const paradaActivaDeOrden = orden ? paradaAbierta(paradas, "M1", orden.id) : null;

  /** Actividades abiertas de la máquina: limpieza y/o cambio de diseño pueden coexistir. */
  const actividadesAbiertas = actividades.filter(
    (a): a is ActividadAbierta => a.fin === null,
  );

  const propsActividades = {
    hoy,
    // CHANGE 1: día al que se atribuyen los eventos nuevos. Igual al consultado
    // mientras no exista navegación histórica (CHANGE 2).
    fechaOperativa: hoy,
    operatorNameInicial: orden?.operatorName ?? "",
    actividades,
    actividadesAbiertas,
    onRegistrarActividad: handleRegistrarActividad,
    onCerrarActividad: handleCerrarActividad,
  };

  /** Prop combinada para la sección de daños — reutilizable en los 4 estados de orden. */
  const danosProps = {
    maquinaId: "M1" as const,
    ordenId: orden?.id ?? null,
    operatorNameInicial: orden?.operatorName ?? "",
    danosDeMaquina: danos,
    // Phase 14.2: el abierto de la máquina vive en estado (seed + loaders + recargar),
    // no se deriva en el render body; el render nunca consulta el puerto.
    danoAbiertoDeMaquina,
    paradasVinculables: paradas.filter((p) => p.ordenId === (orden?.id ?? null)),
    permitirRegistrar: orden?.estado !== "finished",
    fechaOperativa: hoy,
    onRegistrarDano: handleRegistrarDano,
    onCerrarDano: handleCerrarDano,
  };

  /** Prop combinada para la sección de inspección de tela (ticket 07). La orden la aporta cada vista. */
  const inspeccionProps = {
    inspecciones,
    operatorNameInicial: orden?.operatorName ?? "",
    permitirRegistrar: orden?.estado !== "finished",
    onRegistrarInspeccion: handleRegistrarInspeccion,
    onDevolverInspeccion: handleDevolverInspeccion,
    onAutorizarInspeccion: handleAutorizarInspeccion,
  };

  /** Prop combinada para la sección de mantenimiento (ticket 08). */
  const mantenimientoProps = {
    maquinaId: "M1" as const,
    operatorNameInicial: orden?.operatorName ?? "",
    mantenimientosDeMaquina: mantenimientos,
    // Phase 14.2: el abierto de la máquina vive en estado (seed + loaders + recargar);
    // el render body no consulta el puerto. DashboardHome deriva el suyo del estado.
    mantenimientoAbiertoDeMaquina,
    danosDeMaquina: danos,
    permitirRegistrar: orden?.estado !== "finished",
    fechaOperativa: hoy,
    onRegistrarMantenimiento: handleRegistrarMantenimiento,
    onCerrarMantenimiento: handleCerrarMantenimiento,
  };

  const propsResumenTiempo = {
    jornada,
    resumenTiempo,
    onCambiarFinJornada: handleCambiarFinJornada,
  };

  /**
   * Proyección de 2da integrada SOLO cuando hay orden activa: los daños de la
   * orden ya están en `danos` (estado, cargado desde el puerto) y el seam de
   * dominio deriva el resultado. En producción se recalcula con cada render
   * (alerta viva); en finalizada queda fija con los datos de cierre (histórica).
   * No se pasa a EmptyDay ni OrderAvailable.
   */
  // Phase 14.2: los daños de la orden viven en `danosDeOrden` (estado, re-leído tras
  // cada mutación y al cambiar de orden); el render body no filtra el array completo.
  const integracion2da = orden ? proyeccionSegundaDeOrden(orden, danosDeOrden) : null;

  // ---------------------------------------------------------------------------
  // Ticket 09 — DashboardHome: props derivadas de estado existente
  // ---------------------------------------------------------------------------

  /** Parada abierta de la máquina (con o sin orden). */
  const paradaAbiertaMaquina = paradas.find(
    (p) => p.fin === null && p.maquinaId === "M1",
  );

  /** Estado derivado de la máquina: ANDANDO, PARADA u OCIOSA. */
  const estadoMaquina: "andando" | "parada" | "ociosa" = (() => {
    if (paradaAbiertaMaquina) return "parada";
    if (orden?.estado === "in_production") return "andando";
    return "ociosa";
  })();

  /** Props de parada abierta para DashboardHome (causa legible + duración acumulada). */
  const paradaAbiertaProps = paradaAbiertaMaquina
    ? {
        causa:
          getCausaParadaPorId(paradaAbiertaMaquina.causaId)?.nombre ??
          "Causa desconocida",
        duracionSegundos:
          duracionAcumulada(paradaAbiertaMaquina, new Date().toISOString()) ?? 0,
      }
    : null;

  /** Props de mantenimiento abierto para DashboardHome. */
  const mantAbierto = mantenimientoAbierto(mantenimientos, "M1");
  const mantenimientoAbiertoProps = mantAbierto
    ? {
        tipo: mantAbierto.tipo,
        motivo: mantAbierto.motivo,
        duracionSegundos: Math.round(
          (Date.now() - new Date(mantAbierto.inicio).getTime()) / 1000,
        ),
      }
    : null;

  /** Calidad: solo cuando hay orden y NO está finalizada. */
  const calidadProps =
    orden && orden.estado !== "finished" && integracion2da
      ? {
          estado:
            integracion2da.proyeccion.estado === "alerta"
              ? ("alerta" as const)
              : ("buena_racha" as const),
          porcentaje: integracion2da.proyeccion.pct ?? 0,
        }
      : null;

  return (
    <main className="app">
      <header className="app__header">
        <h1 className="app__titulo">Dashboard de Estampado</h1>
        <span className="app__fecha">Fecha operativa: {hoy}</span>
      </header>

      <DashboardHome
        estadoMaquina={estadoMaquina}
        paradaAbierta={paradaAbiertaProps}
        mantenimientoAbierto={mantenimientoAbiertoProps}
        calidad={calidadProps}
        resumenTiempo={resumenTiempo}
      />

      {!orden ? (
        <EmptyDay {...propsActividades} {...propsResumenTiempo} {...danosProps} {...mantenimientoProps} />
      ) : orden.estado === "available" ? (
        <OrderAvailable
          orden={orden}
          onIniciar={handleIniciar}
          {...propsActividades}
          {...propsResumenTiempo}
          {...danosProps}
          {...inspeccionProps}
          {...mantenimientoProps}
        />
      ) : orden.estado === "in_production" ? (
        <OrderInProduction
          orden={orden}
          integracion2da={integracion2da!}
          onRegistrarLectura={handleRegistrarLectura}
          onFinalizar={handleFinalizar}
          paradasDeOrden={paradasDeOrden}
          paradaActivaDeOrden={paradaActivaDeOrden}
          onRegistrarParada={handleRegistrarParada}
          onCerrarParada={handleCerrarParada}
          {...propsActividades}
          {...propsResumenTiempo}
          {...danosProps}
          {...inspeccionProps}
          {...mantenimientoProps}
        />
      ) : orden.estado === "finished" ? (
        <OrderFinished
          orden={orden}
          integracion2da={integracion2da!}
          {...propsActividades}
          {...propsResumenTiempo}
          {...danosProps}
          {...inspeccionProps}
          {...mantenimientoProps}
        />
      ) : (
        <p className="app__pendiente">
          La orden está en estado «{orden.estado}». Su vista llega en ciclos posteriores.
        </p>
      )}
    </main>
  );
}

export default App;