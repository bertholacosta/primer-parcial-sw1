import { describe, expect, it } from "vitest";
import type { DomainModel } from "domain-model";
import {
  javaPackageForClass,
  resolveJavaClassNames,
  restPathForClassName,
  toKebabCase,
  toLowerCamelCase,
  toSnakeCase,
  toUpperCamelCase,
} from "../src/naming.js";

describe("reglas de nombres §6 del contrato generator-input-output v1", () => {
  it("deriva {ClassName} en UpperCamelCase (§6.1)", () => {
    expect(toUpperCamelCase("libro")).toBe("Libro");
    expect(toUpperCamelCase("autor_secundario")).toBe("AutorSecundario");
    expect(toUpperCamelCase("line-item")).toBe("LineItem");
  });

  it("deriva nombres de atributo en lowerCamelCase (§6.3)", () => {
    expect(toLowerCamelCase("titulo")).toBe("titulo");
    expect(toLowerCamelCase("fecha_publicacion")).toBe("fechaPublicacion");
    expect(toLowerCamelCase("line-item")).toBe("lineItem");
  });

  it("deriva rutas REST desde {ClassName} (§6.4)", () => {
    expect(restPathForClassName("Libro")).toBe("/libros");
    expect(restPathForClassName("AutorSecundario")).toBe("/autor-secundarios");
    expect(restPathForClassName("LineItem")).toBe("/line-items");
  });

  it("convierte a snake_case y kebab-case (§6.5)", () => {
    expect(toSnakeCase("fechaPublicacion")).toBe("fecha_publicacion");
    expect(toSnakeCase("AutorSecundario")).toBe("autor_secundario");
    expect(toKebabCase("AutorSecundario")).toBe("autor-secundario");
  });

  const model: DomainModel = {
    contractVersion: "1",
    id: "m-1",
    name: "M",
    version: "1.0.0",
    packages: [
      { id: "pkg-root", name: "Ventas" },
      { id: "pkg-child", name: "Pedidos", parentId: "pkg-root" },
    ],
    classes: [
      { id: "cls-1", name: "Linea", packageId: "pkg-child", attributes: [] },
      { id: "cls-2", name: "Suelta", attributes: [] },
    ],
    associations: [],
  };

  it("construye el paquete Java con la jerarquía raíz → inmediato en minúsculas (§6.2)", () => {
    const [child, loose] = model.classes;
    expect(javaPackageForClass(child, model, "com.example.app")).toBe(
      "com.example.app.ventas.pedidos",
    );
    expect(javaPackageForClass(loose, model, "com.example.app")).toBe("com.example.app");
  });

  it("desambigua colisiones entre paquetes anteponiendo el paquete inmediato (§6.1.2)", () => {
    const collision: DomainModel = {
      ...model,
      packages: [
        { id: "pkg-a", name: "a" },
        { id: "pkg-b", name: "b" },
      ],
      classes: [
        { id: "cls-1", name: "Entidad", packageId: "pkg-a", attributes: [] },
        { id: "cls-2", name: "Entidad", packageId: "pkg-b", attributes: [] },
      ],
    };
    const names = resolveJavaClassNames(collision);
    expect(names.get("cls-1")).toBe("AEntidad");
    expect(names.get("cls-2")).toBe("BEntidad");
  });

  it("lanza NAME_COLLISION cuando la desambiguación no resuelve (§9.2)", () => {
    const collision: DomainModel = {
      ...model,
      packages: [{ id: "pkg-a", name: "a" }],
      classes: [
        { id: "cls-1", name: "A_Entidad", packageId: "pkg-a", attributes: [] },
        { id: "cls-2", name: "Entidad", packageId: "pkg-a", attributes: [] },
        { id: "cls-3", name: "Entidad", attributes: [] },
      ],
    };
    // cls-1 → "AEntidad" (única); cls-2 → "AEntidad" prefijada choca con cls-1;
    // cls-3 → "Entidad" sin prefijo choca con la base de cls-2? no: cls-2 y
    // cls-3 comparten base "Entidad" → cls-2 → "AEntidad", cls-3 → "Entidad";
    // "AEntidad" de cls-2 choca con cls-1 → NAME_COLLISION.
    expect(() => resolveJavaClassNames(collision)).toThrowError(/NAME_COLLISION|mismo nombre/);
  });
});
