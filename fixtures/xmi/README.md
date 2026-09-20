# Fixtures XMI — Enterprise Architect

Corpus acotado de XMI/Enterprise Architect conforme al perfil definido en
`docs/contracts/xmi-profile-v1.md`.

## Estructura

```
fixtures/xmi/
  README.md                          ← este archivo
  01-minimal-import/
    input.xmi                        ← XMI de EA mínimo (clases + atributos)
    expected-canonical.json          ← resultado canónico esperado
    loss-notes.md                    ← notas de pérdida tolerada
  02-associations/
    input.xmi                        ← XMI con asociaciones bidireccionales y unidireccionales
    expected-canonical.json
    loss-notes.md
  03-ignored-elements/
    input.xmi                        ← XMI con extensiones EA, herencia, operaciones
    expected-canonical.json          ← canónico sin los elementos ignorados
    loss-notes.md                    ← lista explícita de pérdidas
  04-error-unknown-type/
    input.xmi                        ← XMI con tipo no soportado (BigDecimal)
    expected-error.json              ← diagnóstico esperado (UNKNOWN_TYPE)
  05-error-self-association/
    input.xmi                        ← XMI con auto-asociación
    expected-error.json              ← diagnóstico esperado (SELF_ASSOCIATION_NOT_SUPPORTED)
  06-round-trip/
    canonical-input.json             ← modelo canónico de entrada para exportación
    expected-xmi-export.xmi          ← XMI esperado tras exportar el canónico
    reimport-canonical.json          ← canónico esperado tras reimportar el XMI exportado
```

## Convenciones

- Todos los `xmi:id` y nombres son ficticios/anonimizados. No contienen datos reales.
- Los archivos `expected-canonical.json` siguen `domain-model-v1` (contractVersion `"1"`).
- Los archivos `expected-error.json` siguen el esquema `{ "outcome": "error", "diagnostics": [...] }`.
- Los archivos `loss-notes.md` listan, por elemento ignorado, la sección del contrato que lo autoriza.
