# XMI adapter

Importación y exportación del subconjunto UML/XMI compatible con Enterprise Architect definido por contrato.

## Política de normalización de multiplicidad y nulabilidad (§3.4, §8)

En UML 2.5 / XMI 2.1 de Enterprise Architect, la multiplicidad y la nulabilidad se representan únicamente a través de los límites `<lowerValue>` y `<upperValue>`. No existe un atributo UML estándar independiente para `nullable`.

Por ello, el adaptador aplica la siguiente política en exportación y round-trip:
- La multiplicidad canónica declarada gobierna los valores emitidos de `lowerValue` y `upperValue`.
- Para modelos con advertencia `NULLABLE_REQUIRED_CONFLICT` (`multiplicity: "1"`, `nullable: true`): se emite `lowerValue="1", upperValue="1"`. Al reimportar, el modelo resultante normaliza `nullable: false`, resolviendo la contradicción.
- Para modelos con advertencia `NOT_NULLABLE_OPTIONAL_CONFLICT` (`multiplicity: "0..1"`, `nullable: false`): se emite `lowerValue="0", upperValue="1"`. Al reimportar, el modelo resultante normaliza `nullable: true`, resolviendo la contradicción.
- Esta pérdida es documentada, determinista y conserva la validez canónica del modelo resultante.
