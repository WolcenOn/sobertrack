# SoberTrack

SoberTrack es una PWA offline-first para educación preventiva, estimación aproximada de BAC en el tiempo y consumo responsable de alcohol. Funciona sin conexión tras la primera carga, guarda los datos en el navegador y no usa frameworks ni dependencias externas.

> Aviso importante: SoberTrack es una herramienta educativa. No mide alcohol real en sangre, no sustituye un alcoholímetro homologado ni debe utilizarse para decidir si una persona puede conducir, trabajar, cuidar a terceros o realizar actividades de riesgo. Ante duda, no conduzcas.

## Funcionalidades

- PWA instalable con `manifest.json` y `service-worker.js`.
- Estrategia offline Network-First / Cache-Fallback.
- Persistencia local con `localStorage`.
- Base interna de bebidas: destilados, cervezas y vinos.
- Vaso interactivo en canvas con hielo y desplazamiento de volumen.
- Estimación temporal BAC basada en Widmark modificado.
- Predicción de curva durante 4 horas.
- Modo conductor con límite configurable y alerta por efecto retraso.
- Reto de hidratación SoberTrack.
- Test de reflejos comparado con la primera partida de la noche.

## Uso local

```bash
python3 -m http.server 8080
```

Abre `http://localhost:8080`.

## Despliegue en GitHub Pages

El repo incluye `.github/workflows/pages.yml`. Activa Pages en GitHub y selecciona GitHub Actions como fuente de despliegue.

## Modelo de cálculo

- r hombre: 0.68
- r mujer: 0.55
- absorción: 30 min con estómago vacío, 90 min con estómago lleno
- eliminación: 0.15 g/L/h, equivalente a 0.0025 g/L/min
- densidad etanol: 0.789 g/ml

La hidratación no reduce el alcohol ingerido; en la app solo se modela como incentivo conductual ralentizando un 10% la absorción de la siguiente copa.

## Licencia

MIT. Consulta `LICENSE`.
