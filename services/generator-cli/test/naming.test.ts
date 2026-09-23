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
    classes: [
      { id: "cls-1", name: "Linea", attributes: [] },
      { id: "cls-2", name: "Suelta", attributes: [] },
    ],
    associations: [],
  };

  it("todas las clases viven en el paquete raíz {basePackage} (§6.2)", () => {
    const [child, loose] = model.classes;
    expect(javaPackageForClass(child, model, "com.example.app")).toBe("com.example.app");
    expect(javaPackageForClass(loose, model, "com.example.app")).toBe("com.example.app");
  });

  it("resuelve los {ClassName} en UpperCamelCase sin prefijos de paquete", () => {
    const names = resolveJavaClassNames(model);
    expect(names.get("cls-1")).toBe("Linea");
    expect(names.get("cls-2")).toBe("Suelta");
  });

  it("lanza NAME_COLLISION ante nombres duplicados en el ámbito raíz (§9.2)", () => {
    const collision: DomainModel = {
      ...model,
      classes: [
        { id: "cls-1", name: "A_Entidad", attributes: [] },
        { id: "cls-2", name: "AEntidad", attributes: [] },
      ],
    };
    expect(() => resolveJavaClassNames(collision)).toThrowError(/NAME_COLLISION|mismo nombre/);
  });
});
