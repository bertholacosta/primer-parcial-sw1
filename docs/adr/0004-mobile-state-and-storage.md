# ADR-0004: estado y almacenamiento del runtime móvil

- Estado: `accepted`
- Decisor: Product Owner
- Fecha: 2026-09-20
- Autor: Kiro (tarea P3-002)
- Relacionado con: `docs/contracts/mobile-offline-v1.md`, `docs/contracts/flutter-descriptor-v1.md`

---

## Pregunta

¿Qué estrategia de estado, persistencia local, migración de esquema y cola offline usará la aplicación Flutter en Android?

---

## Contexto y restricciones

Los contratos `mobile-offline-v1.md` e `flutter-descriptor-v1.md` (ambos `accepted`) definen la semántica observable sin elegir implementación. Las restricciones derivadas de esos contratos son:

1. **Estados del descriptor** — el runtime debe modelar explícitamente los estados `loading`, `ready`, `stale`, `error_contract_mismatch`, `error_missing_field` y `unavailable` (`flutter-descriptor-v1` §14.1). El framework de estado debe poder expresar estos estados como tipos discriminados accesibles síncronamente desde la UI.

2. **Persistencia durable** — el snapshot del descriptor y la cola offline deben sobrevivir a reinicios de app y de dispositivo (`mobile-offline-v1` §2.1, invariante I4, supuesto S2). Se requiere almacenamiento estructurado, no almacenamiento en memoria ni preferencias clave-valor sin garantías de atomicidad.

3. **Migraciones de esquema reproducibles** — la cola offline (`operationId`, `payload`, `status`, `attemptCount`, `enqueuedAt`, etc.) y el registro de confirmaciones tienen esquemas versionados. Cualquier cambio futuro en esos esquemas debe ser reproducible y verificable (`mobile-offline-v1` §12 cambio incompatible).

4. **Cola append-only con orden FIFO por entidad y paralelismo entre entidades distintas** — `mobile-offline-v1` §4.1 y §4.3. La implementación debe consultar eficientemente operaciones por `localId` y `entityClassId`, filtrar por estado y ordenar por `enqueuedAt`.

5. **Backoff exponencial con jitter** — la política de reintento (`mobile-offline-v1` §5.1) es semántica observable; la implementación debe poder programar reintentos con intervalos calculados sin acoplarse a un timer global de la UI.

6. **Límite Android** — el target de la Fase 3 es exclusivamente Android. La elección debe tener evidencia de funcionamiento en Android (no solo en iOS o web).

---

## Alternativas evaluadas

### Opción A — Riverpod 2.x + Drift 2.x (SQLite)

**Descripción:**
- **Estado:** [Riverpod](https://riverpod.dev/) con `AsyncNotifier` para modelar el ciclo de vida del descriptor y de la cola offline. Cada estado del contrato (`loading`, `ready`, `stale`, etc.) se representa como un case del `AsyncValue` o como un sealed class propio expuesto por el `Notifier`.
- **Persistencia:** [Drift](https://drift.simonbinder.eu/) (antes `moor`) sobre SQLite vía `sqflite` en Android. El esquema se define en Dart tipado; Drift genera el código de acceso y los scripts de migración versionados.
- **Migración:** Drift expone `MigrationStrategy` con `onCreate`, `onUpgrade` y `beforeOpen`. Cada versión de esquema tiene un número de versión entero; los scripts de migración son código Dart verificable en CI.
- **Cola offline:** tabla `offline_queue` con columnas `operation_id TEXT PRIMARY KEY`, `operation_type TEXT`, `entity_class_id TEXT`, `local_id TEXT`, `remote_id TEXT`, `payload TEXT`, `enqueued_at TEXT`, `attempt_count INTEGER`, `last_attempt_at TEXT`, `status TEXT`. Drift genera queries tipadas para filtrar por `status`, ordenar por `enqueued_at` y agrupar por `local_id`.
- **Reintento:** un `BackoffScheduler` implementado como clase Dart pura (sin dependencia de framework), invocado desde el `AsyncNotifier` al detectar reconexión o temporizador.

**Evidencia en Android:**
- Drift usa `sqflite` como backend en Android, que delega en la API nativa `SQLiteOpenHelper`. La base de datos se almacena en `getDatabasesPath()` del dispositivo Android, garantizando durabilidad ante reinicios (`mobile-offline-v1` supuesto S2).
- Las pruebas de integración de Drift pueden ejecutarse en un emulador Android con `flutter test integration_test/` o en un emulador de CI con `flutter drive`. Drift también soporta `NativeDatabase.inMemory()` para pruebas unitarias rápidas sin emulador.
- La versión mínima de SDK Android soportada por `drift 2.x` + `sqflite 2.x` es API 21 (Android 5.0), compatible con el rango habitual de proyectos de parcial.

**Estrategia de pruebas:**
| Nivel | Herramienta | Qué verifica |
|---|---|---|
| Unitario | `flutter test` + `NativeDatabase.inMemory()` | Lógica de cola, estados del descriptor, backoff |
| Integración Android | `flutter test integration_test/` en emulador | Durabilidad de la BD ante restart simulado |
| Migración | `drift_dev` test helpers | Cada paso de migración lleva el esquema de versión N a N+1 y es reversible |
| Estado | `AsyncNotifier` + `ProviderContainer` en test | Transiciones de estado sin UI (loading → ready → stale, etc.) |

**Estrategia de migración:**
```dart
// Ejemplo normativo — no es código generado; ilustra la semántica
@DriftDatabase(tables: [OfflineQueue, ConfirmationLog, DescriptorSnapshot])
class AppDatabase extends _$AppDatabase {
  @override
  int get schemaVersion => 2; // incrementar en cada cambio de esquema

  @override
  MigrationStrategy get migration => MigrationStrategy(
    onCreate: (m) => m.createAll(),
    onUpgrade: (m, from, to) async {
      if (from < 2) {
        // Añadir columna last_attempt_at a offline_queue
        await m.addColumn(offlineQueue, offlineQueue.lastAttemptAt);
      }
    },
    beforeOpen: (details) async {
      await customStatement('PRAGMA foreign_keys = ON');
    },
  );
}
```
Cada cambio de esquema incrementa `schemaVersion`. CI ejecuta `dart run drift_dev schema generate` y verifica que el esquema generado coincide con el esperado.

**Ventajas:**
- Migraciones SQL versionadas verificables en CI, directamente derivadas de los requisitos del contrato `mobile-offline-v1` §12.
- `AsyncNotifier` mapea directamente a los estados del contrato `flutter-descriptor-v1` §14.1 como tipos discriminados en Dart.
- SQLite es el motor de almacenamiento nativo de Android; sin dependencias adicionales de runtime.
- La generación de código de Drift (`build_runner`) hace que el esquema sea el único source of truth; los queries erróneos se detectan en tiempo de compilación.

**Desventajas:**
- `build_runner` añade un paso de generación de código al ciclo de desarrollo; puede ser lento en proyectos grandes.
- Drift tiene una curva de aprendizaje inicial para definir tablas en Dart.
- Los `AsyncNotifier` requieren Dart 3 y familiarización con el modelo de providers de Riverpod 2.

---

### Opción B — BLoC 8.x + Hive 4.x / Isar 3.x

**Descripción:**
- **Estado:** [flutter_bloc](https://bloclibrary.dev/) con `Bloc<Event, State>` para modelar el ciclo de vida. Cada estado del contrato se representa como una subclase `sealed` del estado del BLoC.
- **Persistencia:** [Hive](https://docs.hivedb.dev/) (almacenamiento clave-valor tipado basado en `TypeAdapter`) o [Isar](https://isar.community/) (base de datos NoSQL embebida con índices). Hive no requiere generación de SQL; Isar tiene un motor propio diferente de SQLite.
- **Migración:** Hive no tiene soporte nativo de migraciones versionadas; los cambios de esquema requieren código de migración manual con lógica ad hoc. Isar tiene migraciones mediante `migrationCallback`, pero su modelo es NoSQL y no genera scripts SQL verificables.
- **Cola offline:** en Hive, una `Box<OfflineOperation>` con `TypeAdapter` generado por `hive_generator`. En Isar, una colección `OfflineOperation` con índices sobre `status` y `enqueuedAt`.
- **Reintento:** implementado como `EventTransformer` en el BLoC o como servicio separado.

**Evidencia en Android:**
- Hive usa `path_provider` para localizar el directorio de almacenamiento en Android (`getApplicationDocumentsDirectory()`). Es durable ante reinicios de app, pero la ubicación puede variar según la versión de Android y la configuración de `path_provider`.
- Isar compila un binario nativo por arquitectura (arm64-v8a, armeabi-v7a, x86_64); esto añade tamaño al APK y requiere que el pipeline de CI compile para cada ABI de Android objetivo.
- Hive 4.x soporta Android desde API 16; Isar 3.x soporta API 21 en adelante.
- Las pruebas de integración de Hive/Isar requieren un emulador o dispositivo real para validar la ruta de archivos de Android.

**Estrategia de pruebas:**
| Nivel | Herramienta | Qué verifica |
|---|---|---|
| Unitario | `flutter test` + `Hive.init(tempDir)` | Lógica de cola y estados BLoC |
| Integración Android | `flutter test integration_test/` en emulador | Durabilidad de la Box ante restart |
| Migración | Código manual + prueba de migración ad hoc | Sin soporte nativo de versiones de esquema |
| Estado | `bloc_test` + `MockBloc` | Transiciones de estado sin UI |

**Estrategia de migración (Hive):**
```dart
// Ejemplo normativo — ilustra la limitación
Future<void> migrateHiveBoxV1ToV2(Box rawBox) async {
  // Sin versionado nativo; requiere leer todos los registros
  // y reescribirlos con el nuevo TypeAdapter
  final all = rawBox.values.toList();
  await rawBox.clear();
  for (final op in all) {
    // Conversión manual sin garantía de atomicidad
    await rawBox.put(op.operationId, migrateOperation(op));
  }
}
```
La migración de Hive no es atómica y no tiene número de versión de esquema nativo, lo que contradice el requisito de reproducibilidad de `mobile-offline-v1` §12.

**Ventajas:**
- BLoC es ampliamente conocido; la curva de aprendizaje es menor si el equipo ya lo usa.
- Hive es muy rápido para lectura/escritura de objetos serializados simples.
- `bloc_test` es una librería de pruebas madura y expresiva.

**Desventajas:**
- Hive carece de migraciones versionadas verificables; Isar tiene soporte parcial pero su modelo NoSQL dificulta las queries relacionales requeridas por la cola (`mobile-offline-v1` §4.3, dependencias entre operaciones por `localId`).
- Isar añade binarios nativos por ABI de Android, incrementando el tamaño del APK y la complejidad del pipeline CI.
- Hive no garantiza atomicidad en migraciones, contradiciendo el requisito de reproducibilidad del contrato (`mobile-offline-v1` §12).
- Las queries relacionales de la cola (FIFO por `localId`, paralelismo entre entidades) requieren índices y consultas multi-campo que SQLite/Drift maneja de forma natural pero que en Hive requieren código de filtrado en memoria.

---

## Comparación de criterios

| Criterio derivado del contrato | Opción A (Riverpod + Drift) | Opción B (BLoC + Hive/Isar) |
|---|---|---|
| Migraciones versionadas y reproducibles (`mobile-offline-v1` §12) | ✅ `schemaVersion` entero + `MigrationStrategy` verificable en CI | ⚠️ Hive: sin soporte nativo. Isar: parcial |
| Estados discriminados del descriptor (`flutter-descriptor-v1` §14.1) | ✅ `AsyncNotifier` + sealed classes Dart | ✅ `Bloc<Event, State>` + sealed states |
| Consultas relacionales de la cola FIFO (`mobile-offline-v1` §4.3) | ✅ SQL tipado generado por Drift | ⚠️ Requiere filtrado en memoria con Hive |
| Durabilidad Android ante reinicios (`mobile-offline-v1` supuesto S2) | ✅ SQLite nativo Android vía `sqflite` | ✅ Hive con `path_provider`; Isar con binario nativo |
| Tamaño APK / dependencias nativas | ✅ Sin binario adicional (SQLite es parte de AOSP) | ⚠️ Isar añade binario nativo por ABI |
| Pruebas sin emulador (unitarias rápidas) | ✅ `NativeDatabase.inMemory()` | ✅ `Hive.init(tempDir)` |
| Evidencia Android documentada | ✅ `sqflite` API 21+, usado en producción en Android | ✅ Hive API 16+; Isar API 21+ |
| Curva de aprendizaje | ⚠️ `build_runner` necesario; Riverpod 2 requiere Dart 3 | ✅ BLoC ampliamente conocido |

---

## Decisión recomendada

**Opción A: Riverpod 2.x + Drift 2.x**

La opción A es la única que satisface sin excepción el criterio más restrictivo del conjunto de contratos: migraciones de esquema versionadas, reproducibles y verificables en CI (`mobile-offline-v1` §12). La cola offline tiene un esquema relacional con dependencias entre filas (por `localId`, `entityClassId`, `status`) que SQLite/Drift consulta con queries tipados generados en tiempo de compilación. Los estados del descriptor (`loading`, `ready`, `stale`, etc.) se mapean directamente a sealed classes de Dart expuestas por `AsyncNotifier`.

Esta decisión **no modifica** ningún contrato aceptado. El contrato `mobile-offline-v1` §9 invariante I8 establece explícitamente que la implementación no forma parte del contrato.

**Estado de esta decisión:** `accepted` — aprobado explícitamente por el Product Owner el 2026-09-20 (Opción A: Riverpod 2.x + Drift 2.x SQLite).

---

## Consecuencias

### Si se aprueba la Opción A

- `apps/mobile-flutter` usará `flutter_riverpod: ^2.0.0` y `drift: ^2.0.0` como dependencias principales de estado y persistencia.
- El esquema inicial de Drift incluirá las tablas `offline_queue`, `confirmation_log` y `descriptor_snapshot` con los campos definidos en `mobile-offline-v1` §3.2 y §2.1.
- CI deberá ejecutar `dart run drift_dev schema generate` y verificar que el artefacto generado es idempotente (misma entrada → mismo esquema byte a byte).
- Las pruebas unitarias de lógica de cola y estados del descriptor correrán con `NativeDatabase.inMemory()` sin requerir emulador Android.
- Las pruebas de integración Android (durabilidad ante restart) correrán en el emulador de CI con `flutter test integration_test/`.

### Riesgos residuales

| # | Riesgo | Mitigación |
|---|---|---|
| R1 | `build_runner` puede generar artefactos inconsistentes si no se ejecuta antes de compilar | CI ejecuta `dart run build_runner build --delete-conflicting-outputs` como paso previo al `flutter build` |
| R2 | Drift requiere Dart 3; si el SDK mínimo del proyecto es anterior, se necesita actualización | Verificar `sdk: ">=3.0.0"` en `pubspec.yaml` antes de iniciar implementación |
| R3 | Las preguntas abiertas Q1–Q5 de `mobile-offline-v1` §11.3 (mecanismo de push/polling, campo de versión de recurso, sincronización de datos) afectan a la implementación de la cola pero no a la elección de librería | Documentar dependencias en tareas futuras; la elección de Riverpod+Drift es válida bajo cualquier respuesta a esas preguntas |

---

## Comandos exactos para validar el runtime móvil

Los siguientes comandos deben ejecutarse desde la raíz del repositorio una vez que la implementación en `apps/mobile-flutter` exista. Se registran aquí para que el agente de implementación los ejecute y CI los verifique.

```powershell
# 1. Verificar que el archivo ADR no tiene conflictos de merge
git diff --check -- docs/adr/0004-mobile-state-and-storage.md

# 2. Verificar presencia de secciones requeridas por la tarea P3-002
rg -n "Alternativas|Android|migraci|offline|Comandos" docs/adr/0004-mobile-state-and-storage.md

# 3. Generar código Drift y verificar idempotencia (ejecutar desde apps/mobile-flutter)
# dart run build_runner build --delete-conflicting-outputs
# dart run drift_dev schema generate

# 4. Ejecutar pruebas unitarias Flutter (sin emulador)
# flutter test --no-pub

# 5. Ejecutar pruebas de integración Android en emulador CI
# flutter test integration_test/ --no-pub

# 6. Verificar que el esquema generado por Drift es idempotente
# dart run drift_dev schema verify

# 7. Compilar APK debug para Android (verifica que no hay errores de compilación)
# flutter build apk --debug

# 8. Verificar SDK mínimo Android (API 21) en AndroidManifest
# rg -n "minSdkVersion" apps/mobile-flutter/android/app/build.gradle
```

> **Nota:** los comandos 3–8 requieren que `apps/mobile-flutter` exista con el `pubspec.yaml` configurado. Se registran aquí para el agente de implementación; en el estado actual del repositorio (sin implementación Flutter) solo los comandos 1 y 2 son ejecutables y son los declarados en `validation_commands` de la tarea.

---

## Preguntas abiertas heredadas de los contratos

Las siguientes preguntas de `mobile-offline-v1` §11.3 y `flutter-descriptor-v1` §13.3 no bloquean la elección de librería pero deben resolverse antes de implementar las fases correspondientes:

| # | Pregunta | Fuente | Impacto en implementación |
|---|---|---|---|
| Q1 | ¿El descriptor se entrega embebido en el paquete Flutter o se descarga en runtime? | `flutter-descriptor-v1` §13.3 Q3 | Afecta al mecanismo de arranque del `DescriptorNotifier` |
| Q2 | ¿El mecanismo de notificación de cambio de modelo es push o polling? | `mobile-offline-v1` §11.3 Q1 | Afecta al ciclo de sincronización del `DescriptorNotifier` |
| Q3 | ¿El campo de versión de recurso para conflictos en `update` es ETag, número de versión o timestamp? | `mobile-offline-v1` §11.3 Q2 | Afecta al esquema de la tabla `offline_queue` (columna adicional) |
| Q4 | ¿El límite de 72 horas para `OPERATION_EXPIRED` es configurable remotamente? | `mobile-offline-v1` §11.3 Q4 | Afecta a si se necesita una tabla de configuración remota en Drift |

Estas preguntas requieren aprobación del Product Owner. Se registran aquí para que queden visibles al integrador en la fase de implementación.

---

## Referencias

- `docs/contracts/mobile-offline-v1.md` — semántica observable de la cola offline
- `docs/contracts/flutter-descriptor-v1.md` — estados del descriptor y ciclo de vida runtime
- `docs/adr/0000-foundational-decisions.md` — ADR fundacional
- [Riverpod 2.x — documentación oficial](https://riverpod.dev/docs/introduction/getting_started)
- [Drift 2.x — documentación oficial](https://drift.simonbinder.eu/docs/getting-started/)
- [sqflite en Android — documentación](https://pub.dev/packages/sqflite)
- [flutter_bloc — documentación oficial](https://bloclibrary.dev/)
- [Hive 4.x — documentación](https://docs.hivedb.dev/)
