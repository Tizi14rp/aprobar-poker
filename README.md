# Aprobar Poker

App web instalable (celular y PC) para aprobar o rechazar los posts de Instagram de **@pokerbuenosaires** que prepara Claude cada mañana.

- **Pendientes:** ves las imágenes, el caption y las alertas de cada post. *Aprobar* hace Merge del PR (se publica en la ventana de 11:15 a 12:30), *Pedir cambios* deja un comentario para Claude y *Rechazar* cierra el PR.
- **Aprobados:** qué está en cola y el enlace de lo ya publicado.

Este repo también sirve, en `media/`, **solo** las imágenes y videos ya aprobados: Instagram los descarga desde acá con GitHub Pages.

## Instalarla

1. Abrí `https://tizi14rp.github.io/aprobar-poker/` en el celular.
2. Android (Chrome): menú ⋮ → *Instalar app*. iPhone (Safari): Compartir → *Agregar a inicio*.
3. La primera vez pegá un **fine-grained token** de GitHub con acceso solo a `poker-ig-brain` y permisos *Contents* y *Pull requests* en *Read and write*. Queda guardado solo en ese dispositivo; desde *Ajustes* lo podés borrar.

No guarda nada en ningún servidor: habla directamente con la API de GitHub.
