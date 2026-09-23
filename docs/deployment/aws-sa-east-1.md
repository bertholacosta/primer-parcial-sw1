# Despliegue integral en AWS (`sa-east-1`)

Estado: despliegue iniciado y bloqueado por verificación de la cuenta AWS, 2026-09-23. Destino indicado por el Product Owner: cuenta `687979656624`, usuario `acosta.berthol`, región `sa-east-1`. Límite declarado: USD 100 durante unos 15 días. La implementación directa en este worktree, sin Orca, fue autorizada explícitamente. Tras dos intentos fallidos de EC2 RunInstances en `sa-east-1`, la tarea DEP-002 volvió a análisis conforme a AGENTS.md; no se deben repetir intentos hasta que AWS confirme la habilitación de la cuenta o se apruebe otra arquitectura.

El paquete está en el bucket privado `primer-parcial-sw1-deploy-687979656624` como `case-deploy.zip`. Se intentó lanzar una EC2 `t3.small` con Ubuntu 24.04, EBS gp3 cifrado de 30 GiB, SSH cerrado, HTTP/HTTPS abiertos, créditos de CPU estándar y datos de arranque para descargar el paquete. AWS creó el grupo de seguridad, pero **rechazó el lanzamiento de EC2** con: `This account is currently blocked and not recognized as a valid account`. No existe una instancia de esta tarea ni un servicio publicado. AWS remite a un caso de soporte de verificación de cuenta. La URL prefirmada de S3 usada en los datos de arranque caduca en 60 minutos y deberá regenerarse antes de un nuevo intento.

Se abrió el caso de AWS Support **179016314600087** el 2026-09-23 (tipo Cuenta y facturación, servicio Account Activation, categoría Account Verification). Estado observado: **Sin asignar**. [Abrir caso en AWS Support](https://support.console.aws.amazon.com/support/home?interactionId=0ca2d07b-402d-49ff-8c7e-c8bddb278038&issueType=customer-service&serviceCode=account-management&categoryCode=account-verification#/case/?displayId=179016314600087&language=es). La solicitud incluye únicamente el ID de cuenta, la región y los mensajes de error; no se enviaron credenciales ni la URL prefirmada.

El Product Owner creó por su cuenta la instancia `i-0b33d91ccec1404aa` en `us-east-1` con Amazon Linux y `t8i.small`. No era el servidor preparado para CASE. Tras confirmar que solo tenía un disco raíz de 8 GiB, configurado para eliminarse con la instancia, el Product Owner autorizó terminarla. AWS confirmó el estado final **«Terminada»** y que ya no tiene dispositivos de bloque asociados.

Con autorización específica se intentó de nuevo lanzar la instancia preparada en `sa-east-1`: Ubuntu 24.04, `t3.small`, volumen gp3 cifrado de 30 GiB, créditos de CPU estándar, sin SSH y con HTTP/HTTPS mediante el grupo `sg-062dac82c2b63b6db`. Se generó otra URL prefirmada de S3 de 60 minutos para el paquete privado y se cargaron datos de arranque que verifican su SHA-256. **RunInstances volvió a fallar** con `This account is currently blocked and not recognized as a valid account`. No se creó la nueva instancia. Este segundo fallo activa la regla de AGENTS.md que devuelve DEP-002 a análisis; queda pendiente la intervención de AWS Support. Se actualizó el caso `179016314600087` con la evidencia de que EC2 se pudo crear en `us-east-1`, pero no en `sa-east-1`.

Se creó el presupuesto AWS **CASE-SW1-15d-20260923** de USD 80 para todos los servicios de la cuenta, periodo personalizado del 23 de septiembre al 9 de octubre de 2026. Las alertas por costo real superior a USD 40 y USD 80 se envían al correo de contacto autorizado por el Product Owner. [Abrir presupuesto](https://us-east-1.console.aws.amazon.com/costmanagement/home#/budgets/details?name=CASE-SW1-15d-20260923). AWS indica que los datos de gasto pueden tardar hasta 24 horas; las alertas no detienen recursos automáticamente y no constituyen un límite duro.

## Inventario y alcance

| Componente | Estado actual y forma de entrega |
| --- | --- |
| `apps/case-web` | Vite/React. Genera archivos estáticos con `npm run build`; los clientes REST y WebSocket usan rutas del mismo origen (`/api`, `/collaboration`). Se publica el contenido de `dist/`. |
| `services/model-server` | Node.js 20+, REST y WebSocket/STOMP, con PostgreSQL 16. Requiere `DATABASE_URL`, `JWT_SECRET` y `CORS_ORIGINS`; escucha en `127.0.0.1` por defecto, así que en contenedor necesita `HOST=0.0.0.0`. `/health` verifica la base de datos. Las migraciones se ejecutan al arrancar. |
| `apps/mobile-flutter` | App Android con funciones offline y modelos de IA locales. Se compila como APK/AAB y se distribuye por un canal Android; no es un servidor que deba permanecer encendido en AWS. La integración de producción con el backend debe validarse en un dispositivo. |
| `services/generator-cli` y plantillas Spring Boot | Herramienta CLI de compilación/generación. Se ejecuta bajo demanda en CI o una estación autorizada. Los proyectos Spring Boot que genere son productos separados, con despliegue y base de datos propios; no se deben publicar automáticamente como parte del servidor CASE. |
| `packages/*` | Bibliotecas de los componentes anteriores. No requieren servicios AWS independientes. |

El estado del repositorio no equivale todavía a una entrega completa al usuario final: el `model-server` usa `NoopMailer`, por lo que las invitaciones por correo no salen; los enlaces compartibles sí tienen flujo REST. El servidor limita peticiones en memoria y el ADR-0008 establece una sola instancia escritora por diagrama. La propuesta con IA visual necesita configurar Gemini o un Ollama alcanzable; sin proveedor, su endpoint responde `AI_NOT_CONFIGURED`.

## Topología propuesta para 15 días

```text
Navegador ─ HTTPS ─ EC2 t3.small ─ Caddy ─┬─ /: case-web estático
                                            ├─ /api/*: model-server Node.js
                                            └─ /collaboration: WebSocket/STOMP
                                                       │
                                                       └─ PostgreSQL 16 en volumen EBS cifrado

EC2 ─ S3 privado: paquete de instalación
systemd timer: parada a los 15 días desde el aprovisionamiento
Android APK/AAB ─ distribución móvil; conexión HTTPS al dominio anterior cuando corresponda
```

Esta es una instalación temporal de **una sola instancia**, sin alta disponibilidad. Caddy sirve la web y proxifica API y WebSocket en el mismo origen, por lo que no hace falta ALB, NAT, RDS ni CloudFront. Configurar `CORS_ORIGINS` con el origen HTTPS exacto y `SECURE_COOKIES=true`. La URL HTTPS requiere un dominio controlado por el usuario o, para la prueba, un subdominio gratuito que resuelva a la IP pública de la instancia, por ejemplo `IP.sslip.io`; este último depende de un DNS de terceros y se reemplaza al pasar a producción. No cargar datos sensibles reales en la prueba. Mantener el puerto PostgreSQL cerrado al exterior y publicar solo 80/443. SSH queda cerrado; la receta inicial no incluye acceso administrativo remoto. Para diagnosticar fallos de arranque se usan los registros de instancia de EC2. Un acceso de mantenimiento por SSM requiere un perfil IAM específico en una tarea posterior.

La única instancia respeta el secuenciador único aceptado por ADR-0008. PostgreSQL y el backend se ejecutan como servicios con reinicio automático; los datos viven en EBS, no en el filesystem efímero de un contenedor. Una falla de la instancia causa indisponibilidad hasta restaurar desde snapshot o respaldo. No prometer este entorno como producción de alta disponibilidad.

## Construcción, secretos y operación

1. Compilar `case-web` y `model-server` y empaquetar el código mediante `deploy/aws/package.ps1`. El paquete incluye el `dist/` web y el código fuente del backend para construir la imagen en EC2. Elegir `t3.small` x86 para evitar una adaptación de dependencias nativas a ARM sin validación.
2. Crear una instancia Ubuntu 24.04 `t3.small` con volumen gp3 cifrado de 30 GiB. Deshabilitar SSH público y usar créditos de CPU estándar. Los datos de usuario descargan `case-deploy.zip` desde S3 con una URL prefirmada de una hora y ejecutan `deploy/aws/bootstrap-ubuntu.sh`.
3. El script genera un `JWT_SECRET` y una contraseña PostgreSQL aleatorios, distintos de los de desarrollo, en `/opt/case/deploy/aws/.env`, accesible solo a root. Los secretos quedan en el volumen EBS cifrado; no se ha configurado Parameter Store. `compose.yaml` configura `HOST=0.0.0.0` dentro de la red Docker privada, `CORS_ORIGINS` con el origen HTTPS exacto y `SECURE_COOKIES=true`.
4. Configurar Caddy para servir `dist/` y proxificar `/api/*` y `/collaboration` al backend local con WebSocket. Permitir fallback SPA solo para rutas de navegación, sin transformar errores API en HTML. El certificado TLS se obtiene para el dominio elegido.
5. La receta programa la **parada de EC2 a los 15 días** desde el inicio mediante un timer de systemd. El presupuesto y dos alertas de costo están configurados. Quedan pendientes el respaldo diario, prueba de restauración y alarma de disponibilidad; no se deben dar por configurados hasta verificarlos. Revisar después recursos residuales (EBS, snapshots y S3), que pueden seguir cobrando. AWS Budgets informa con retraso y no garantiza un límite duro de USD 100.
6. Compilar el Android APK/AAB firmado mediante su proceso propio; probar contra el endpoint público, incluyendo pérdida y recuperación de conectividad. La publicación en una tienda requiere cuenta y firma de distribución separadas.

Las migraciones de `model-server` corren al iniciar: antes de cada actualización hay que comprobar su compatibilidad con la versión anterior y crear un respaldo de PostgreSQL. Para revertir, restaurar el paquete del commit anterior y la base de datos correspondiente si la migración no es compatible hacia atrás. No se deben borrar datos para revertir.

## Validación y criterios de salida

- Desde la raíz: `git diff --check`; compilar y probar `apps/case-web` y `services/model-server` con los comandos de sus respectivos `package.json`.
- Verificar cuenta `687979656624` y región `sa-east-1` antes de cualquier operación de escritura; inventariar recursos existentes para evitar duplicados.
- En staging: `GET /health` responde 200; registrar, iniciar sesión, renovar cookie segura y cerrar sesión; crear un diagrama, compartir enlace, unir dos clientes y comprobar persistencia tras reiniciar la tarea ECS.
- Comprobar que un lector no puede mutar el diagrama y que WebSocket reconecta después de reiniciar el servidor.
- Inspeccionar que PostgreSQL y S3 no tienen acceso público, que TLS es válido, que secretos no aparecen en logs y que la alarma de presupuesto se recibe.
- Validar APK/AAB en Android real o emulador, modo offline y reconexión con el backend desplegado.

## Presupuesto preliminar y decisiones pendientes

Para 360 horas con una sola EC2 `t3.small`, 30 GiB gp3, una IPv4 pública, backups pequeños en S3, logs y tráfico bajo, reservar **USD 40–80 por 15 días** como hipótesis de planificación. No es una cotización regional verificada: descuentos, impuestos, CPU burst, volumen de datos y tráfico pueden alterar el importe. No provisionar si la estimación de [AWS Pricing Calculator](https://calculator.aws/) para `sa-east-1` y el inventario de gastos existentes dejan menos de USD 20 de margen bajo el máximo de USD 100. Las tarifas dependen de [EC2](https://aws.amazon.com/ec2/pricing/on-demand/), [EBS](https://aws.amazon.com/ebs/pricing/) e [IPv4 pública](https://aws.amazon.com/vpc/pricing/). En esta arquitectura no se incurre en NAT, ALB, Fargate ni RDS.

Verificación de la cuenta realizada el 2026-09-23: la consola muestra el ID `687979656624`; el panel EC2 en `sa-east-1` no tenía instancias antes del intento. La facturación muestra **USD 100 de créditos restantes** del plan gratuito, con 181 días de vigencia. AWS todavía prepara los datos de costos y uso (indica hasta 24 horas); el presupuesto ya está creado. CloudShell rechaza crear su entorno porque la verificación de la cuenta sigue en curso (AWS indica hasta dos días para cuentas nuevas). El intento de lanzamiento EC2 confirmó el bloqueo de cuenta descrito arriba.

Pendiente para ejecutar el despliegue: concluir la verificación de la cuenta con AWS, regenerar la URL prefirmada, relanzar EC2 y hacer la validación funcional. El `NoopMailer` requiere una tarea de implementación antes de prometer invitaciones por correo; la IA visual necesita un proveedor y posiblemente costo adicional. Los respaldos y la restauración también siguen pendientes.

## Referencias AWS

- [Detener instancias EC2](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Stop_Start.html)
- [Acciones de AWS Budgets](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-controls.html)
- [DNS temporal sslip.io](https://github.com/cunnie/docs/blob/main/sslip.io.md)
