import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DashboardHome } from "./DashboardHome";
import type { DashboardHomeProps } from "./DashboardHome";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const RESUMEN_VACIO: DashboardHomeProps["resumenTiempo"] = {
  totalDisponible: 36000,
  planificado: 3600,
  incidencias: 1800,
  productivo: 30600,
};

const defaultProps: DashboardHomeProps = {
  estadoMaquina: "ociosa",
  paradaAbierta: null,
  mantenimientoAbierto: null,
  calidad: null,
  resumenTiempo: RESUMEN_VACIO,
};

describe("DashboardHome — componente presentacional", () => {
  it("renderiza sin errores", () => {
    render(<DashboardHome {...defaultProps} />);
    expect(screen.getByTestId("dashboard-home")).toBeTruthy();
  });

  it("tiene role='status' y aria-label correctos", () => {
    render(<DashboardHome {...defaultProps} />);
    const section = screen.getByTestId("dashboard-home");
    expect(section.getAttribute("role")).toBe("status");
    expect(section.getAttribute("aria-label")).toBe("Estado de la máquina");
  });
});

describe("DashboardHome — estados de máquina", () => {
  it("renderiza ANDANDO con icono y texto", () => {
    render(<DashboardHome {...defaultProps} estadoMaquina="andando" />);
    expect(screen.getAllByText(/ANDANDO/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/▶/).length).toBeGreaterThan(0);
  });

  it("renderiza PARADA con icono y texto", () => {
    render(<DashboardHome {...defaultProps} estadoMaquina="parada" />);
    expect(screen.getAllByText(/PARADA/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/⏸/).length).toBeGreaterThan(0);
  });

  it("renderiza OCIOSA con icono y texto", () => {
    render(<DashboardHome {...defaultProps} estadoMaquina="ociosa" />);
    expect(screen.getAllByText(/OCIOSA/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/—/).length).toBeGreaterThan(0);
  });
});

describe("DashboardHome — parada abierta", () => {
  it("muestra causa y duración cuando hay parada", () => {
    render(
      <DashboardHome
        {...defaultProps}
        paradaAbierta={{ causa: "Falta de color", duracionSegundos: 120 }}
      />,
    );
    expect(screen.getAllByText(/Falta de color/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2 min/).length).toBeGreaterThan(0);
  });

  it("no muestra línea de parada cuando paradaAbierta es null", () => {
    render(<DashboardHome {...defaultProps} />);
    expect(screen.queryByText(/PARADA —/)).toBeNull();
  });

  it("formatea duración mayor a 60 minutos como 'X h Y min'", () => {
    render(
      <DashboardHome
        {...defaultProps}
        paradaAbierta={{ causa: "Daño mecánico", duracionSegundos: 3720 }}
      />,
    );
    expect(screen.getAllByText(/1 h 2 min/).length).toBeGreaterThan(0);
  });
});

describe("DashboardHome — mantenimiento abierto", () => {
  it("muestra tipo, motivo y duración cuando hay mantenimiento", () => {
    render(
      <DashboardHome
        {...defaultProps}
        mantenimientoAbierto={{
          tipo: "reactivo",
          motivo: "Reparación de eje",
          duracionSegundos: 3600,
        }}
      />,
    );
    expect(screen.getAllByText(/Mantenimiento reactivo/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Reparación de eje/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1 h/).length).toBeGreaterThan(0);
  });

  it("no muestra línea de mantenimiento cuando mantenimientoAbierto es null", () => {
    render(<DashboardHome {...defaultProps} />);
    expect(screen.queryByText(/Mantenimiento/)).toBeNull();
  });
});

describe("DashboardHome — calidad", () => {
  it("muestra 'Buena racha' y porcentaje cuando calidad existe", () => {
    render(
      <DashboardHome
        {...defaultProps}
        calidad={{ estado: "buena_racha", porcentaje: 0.032 }}
      />,
    );
    expect(screen.getAllByText(/Buena racha/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/3.2%/).length).toBeGreaterThan(0);
  });

  it("muestra 'Alerta' y porcentaje cuando calidad estado es alerta", () => {
    render(
      <DashboardHome
        {...defaultProps}
        calidad={{ estado: "alerta", porcentaje: 0.067 }}
      />,
    );
    expect(screen.getAllByText(/Alerta/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/6.7%/).length).toBeGreaterThan(0);
  });

  it("oculta la sección de calidad cuando calidad es null", () => {
    render(<DashboardHome {...defaultProps} />);
    expect(screen.queryByText(/Buena racha/)).toBeNull();
    expect(screen.queryByText(/Alerta/)).toBeNull();
  });
});

describe("DashboardHome — resumen de tiempo", () => {
  it("muestra los cuatro buckets con duraciones formateadas", () => {
    render(<DashboardHome {...defaultProps} />);
    expect(screen.getByTestId("dashboard-home_disponible")).toBeTruthy();
    expect(screen.getByTestId("dashboard-home_planificado")).toBeTruthy();
    expect(screen.getByTestId("dashboard-home_incidencias")).toBeTruthy();
    expect(screen.getByTestId("dashboard-home_productivo")).toBeTruthy();
  });

  it("formatea tiempo disponible correctamente (10 h)", () => {
    render(<DashboardHome {...defaultProps} />);
    expect(screen.getByTestId("dashboard-home_disponible").textContent).toContain("10 h");
  });

  it("formatea tiempo planificado correctamente (1 h)", () => {
    render(<DashboardHome {...defaultProps} />);
    expect(screen.getByTestId("dashboard-home_planificado").textContent).toContain("1 h");
  });

  it("formatea incidencias correctamente (30 min)", () => {
    render(<DashboardHome {...defaultProps} />);
    expect(screen.getByTestId("dashboard-home_incidencias").textContent).toContain("30 min");
  });

  it("formatea productivo correctamente (8 h 30 min)", () => {
    render(<DashboardHome {...defaultProps} />);
    expect(screen.getByTestId("dashboard-home_productivo").textContent).toContain("8 h 30 min");
  });
});

describe("DashboardHome — 9 escenarios de estados vacíos", () => {
  const RESUMEN: DashboardHomeProps["resumenTiempo"] = {
    totalDisponible: 36000,
    planificado: 3600,
    incidencias: 1800,
    productivo: 30600,
  };

  it("1. Día sin orden + sin parada + sin mantenimiento → OCIOSA", () => {
    render(
      <DashboardHome
        estadoMaquina="ociosa"
        paradaAbierta={null}
        mantenimientoAbierto={null}
        calidad={null}
        resumenTiempo={RESUMEN}
      />,
    );
    expect(screen.getAllByText(/OCIOSA/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/PARADA —/)).toBeNull();
    expect(screen.queryByText(/Mantenimiento/)).toBeNull();
    expect(screen.queryByText(/Buena racha/)).toBeNull();
  });

  it("2. Día sin orden + parada abierta → PARADA + causa + duración", () => {
    render(
      <DashboardHome
        estadoMaquina="parada"
        paradaAbierta={{ causa: "Falta de tela", duracionSegundos: 600 }}
        mantenimientoAbierto={null}
        calidad={null}
        resumenTiempo={RESUMEN}
      />,
    );
    expect(screen.getAllByText(/PARADA/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Falta de tela/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/10 min/).length).toBeGreaterThan(0);
  });

  it("3. Día sin orden + mantenimiento abierto → OCIOSA + mantenimiento", () => {
    render(
      <DashboardHome
        estadoMaquina="ociosa"
        paradaAbierta={null}
        mantenimientoAbierto={{
          tipo: "preventivo",
          motivo: "Limpieza general",
          duracionSegundos: 1800,
        }}
        calidad={null}
        resumenTiempo={RESUMEN}
      />,
    );
    expect(screen.getAllByText(/OCIOSA/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Mantenimiento preventivo/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Limpieza general/).length).toBeGreaterThan(0);
  });

  it("4. Día sin orden + parada + mantenimiento → PARADA + ambos", () => {
    render(
      <DashboardHome
        estadoMaquina="parada"
        paradaAbierta={{ causa: "Rotura de cuadro", duracionSegundos: 900 }}
        mantenimientoAbierto={{
          tipo: "reactivo",
          motivo: "Cambio de eje",
          duracionSegundos: 2400,
        }}
        calidad={null}
        resumenTiempo={RESUMEN}
      />,
    );
    expect(screen.getAllByText(/PARADA/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Rotura de cuadro/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Mantenimiento reactivo/).length).toBeGreaterThan(0);
  });

  it("5. Orden disponible + sin parada → OCIOSA (sin calidad)", () => {
    render(
      <DashboardHome
        estadoMaquina="ociosa"
        paradaAbierta={null}
        mantenimientoAbierto={null}
        calidad={null}
        resumenTiempo={RESUMEN}
      />,
    );
    expect(screen.getAllByText(/OCIOSA/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Buena racha/)).toBeNull();
  });

  it("6. Orden en producción + sin parada → ANDANDO + calidad", () => {
    render(
      <DashboardHome
        estadoMaquina="andando"
        paradaAbierta={null}
        mantenimientoAbierto={null}
        calidad={{ estado: "buena_racha", porcentaje: 0.042 }}
        resumenTiempo={RESUMEN}
      />,
    );
    expect(screen.getAllByText(/ANDANDO/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Buena racha/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/4.2%/).length).toBeGreaterThan(0);
  });

  it("7. Orden en producción + parada abierta → PARADA + calidad", () => {
    render(
      <DashboardHome
        estadoMaquina="parada"
        paradaAbierta={{ causa: "Ajuste de registro", duracionSegundos: 300 }}
        mantenimientoAbierto={null}
        calidad={{ estado: "alerta", porcentaje: 0.071 }}
        resumenTiempo={RESUMEN}
      />,
    );
    expect(screen.getAllByText(/PARADA/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Ajuste de registro/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Alerta/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/7.1%/).length).toBeGreaterThan(0);
  });

  it("8. Orden finalizada + sin parada → OCIOSA (sin calidad)", () => {
    render(
      <DashboardHome
        estadoMaquina="ociosa"
        paradaAbierta={null}
        mantenimientoAbierto={null}
        calidad={null}
        resumenTiempo={RESUMEN}
      />,
    );
    expect(screen.getAllByText(/OCIOSA/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Buena racha/)).toBeNull();
    expect(screen.queryByText(/Alerta/)).toBeNull();
  });

  it("9. Orden finalizada + parada abierta → PARADA (sin calidad)", () => {
    render(
      <DashboardHome
        estadoMaquina="parada"
        paradaAbierta={{ causa: "Problema de horno", duracionSegundos: 180 }}
        mantenimientoAbierto={null}
        calidad={null}
        resumenTiempo={RESUMEN}
      />,
    );
    expect(screen.getAllByText(/PARADA/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Problema de horno/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Buena racha/)).toBeNull();
    expect(screen.queryByText(/Alerta/)).toBeNull();
  });
});

describe("DashboardHome — fallback de causa", () => {
  it("muestra 'Causa desconocida' cuando la causa está vacía", () => {
    render(
      <DashboardHome
        {...defaultProps}
        paradaAbierta={{ causa: "", duracionSegundos: 100 }}
      />,
    );
    expect(screen.getAllByText(/Causa desconocida/).length).toBeGreaterThan(0);
  });
});

describe("DashboardHome — timer y cleanup", () => {
  it("el timer se activa y limpia al desmontar", () => {
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const { unmount } = render(<DashboardHome {...defaultProps} />);
    unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });

  it("no lingering timers después de desmontar", () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const { unmount } = render(<DashboardHome {...defaultProps} />);
    const timerId = setIntervalSpy.mock.results[0]?.value;
    unmount();
    // El timer fue limpiado
    expect(clearIntervalSpy).toHaveBeenCalledWith(timerId);
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });
});

describe("DashboardHome — accesibilidad", () => {
  it("usa role='status' en el contenedor principal", () => {
    render(<DashboardHome {...defaultProps} />);
    const section = screen.getByTestId("dashboard-home");
    expect(section.getAttribute("role")).toBe("status");
  });

  it("usa aria-label='Estado de la máquina'", () => {
    render(<DashboardHome {...defaultProps} />);
    const section = screen.getByTestId("dashboard-home");
    expect(section.getAttribute("aria-label")).toBe("Estado de la máquina");
  });

  it("el texto del estado es explícito (no depende solo de color o ícono)", () => {
    render(<DashboardHome {...defaultProps} estadoMaquina="andando" />);
    expect(screen.getByText(/ANDANDO/)).toBeTruthy();
  });
});

describe("DashboardHome — edge cases", () => {
  it("duración de 0 segundos muestra '0 min'", () => {
    render(
      <DashboardHome
        {...defaultProps}
        paradaAbierta={{ causa: "Falta de color", duracionSegundos: 0 }}
      />,
    );
    expect(screen.getAllByText(/0 min/).length).toBeGreaterThan(0);
  });

  it("duración exacta de 60 minutos muestra '1 h'", () => {
    render(
      <DashboardHome
        {...defaultProps}
        paradaAbierta={{ causa: "Falta de tela", duracionSegundos: 3600 }}
      />,
    );
    expect(screen.getAllByText(/1 h/).length).toBeGreaterThan(0);
  });

  it("parada y mantenimiento simultáneos se muestran ambos", () => {
    render(
      <DashboardHome
        {...defaultProps}
        paradaAbierta={{ causa: "Falta de color", duracionSegundos: 120 }}
        mantenimientoAbierto={{
          tipo: "reactivo",
          motivo: "Fusible quemado",
          duracionSegundos: 600,
        }}
      />,
    );
    expect(screen.getAllByText(/Falta de color/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Fusible quemado/).length).toBeGreaterThan(0);
  });

  it("porcentaje de calidad 0% se muestra correctamente", () => {
    render(
      <DashboardHome
        {...defaultProps}
        calidad={{ estado: "buena_racha", porcentaje: 0 }}
      />,
    );
    expect(screen.getAllByText(/0.0%/).length).toBeGreaterThan(0);
  });

  it("porcentaje de calidad 100% se muestra correctamente", () => {
    render(
      <DashboardHome
        {...defaultProps}
        calidad={{ estado: "alerta", porcentaje: 1 }}
      />,
    );
    expect(screen.getAllByText(/100.0%/).length).toBeGreaterThan(0);
  });
});
