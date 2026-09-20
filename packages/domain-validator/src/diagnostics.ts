/**
 * Diagnósticos del validador — códigos estables definidos por el contrato
 * domain-model v1 (§6) más los códigos internos necesarios para cubrir el
 * resto de restricciones declaradas.
 */

export const DiagnosticCode = {
  MISSING_REQUIRED_FIELD: "MISSING_REQUIRED_FIELD",
  INVALID_FIELD_TYPE: "INVALID_FIELD_TYPE",
  INVALID_IDENTIFIER: "INVALID_IDENTIFIER",
  INVALID_VERSION_FORMAT: "INVALID_VERSION_FORMAT",
  INVALID_MULTIPLICITY: "INVALID_MULTIPLICITY",
  INVALID_NAVIGABILITY: "INVALID_NAVIGABILITY",
  INVALID_ENUM_VALUE: "INVALID_ENUM_VALUE",
  INVALID_VALUE: "INVALID_VALUE",
  UNSUPPORTED_CONTRACT_VERSION: "UNSUPPORTED_CONTRACT_VERSION",
  UNKNOWN_TYPE: "UNKNOWN_TYPE",
  UNRESOLVED_REFERENCE: "UNRESOLVED_REFERENCE",
  DUPLICATE_ID: "DUPLICATE_ID",
  DUPLICATE_NAME: "DUPLICATE_NAME",
  PACKAGE_CYCLE: "PACKAGE_CYCLE",
  SELF_ASSOCIATION: "SELF_ASSOCIATION",
  NULLABLE_REQUIRED_CONFLICT: "NULLABLE_REQUIRED_CONFLICT",
  NOT_NULLABLE_OPTIONAL_CONFLICT: "NOT_NULLABLE_OPTIONAL_CONFLICT",
  UNKNOWN_FIELD: "UNKNOWN_FIELD",
  OUT_OF_CANONICAL_ORDER: "OUT_OF_CANONICAL_ORDER",
} as const;

export type DiagnosticCode = (typeof DiagnosticCode)[keyof typeof DiagnosticCode];

export type Severity = "ERROR" | "WARNING";

export interface Diagnostic {
  code: DiagnosticCode;
  /** Ruta JSONPath, p. ej. `$.classes[0].attributes[0].type`. */
  path: string;
  message: string;
  severity: Severity;
}

export interface ValidationResult {
  /** true cuando no hay diagnósticos bloqueantes (errors.length === 0). */
  valid: boolean;
  errors: Diagnostic[];
  warnings: Diagnostic[];
}
