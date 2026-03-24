# Question Coach React Scaffold

This scaffold rebuilds the provided static frontend as a React application with shared stage memory and drag-and-drop workflows.

## Preserved backend integration

The frontend still calls:

- `GET /health`
- `GET /stages`
- `POST /chat`

The `POST /chat` payload still includes:

- `message`
- `search_limit`
- `search_strategy`
- `use_gemini`
- `gemini_model`
- `system_prompt`

## Added capabilities

- Stage-local React components
- Shared memory across stages
- Drag-and-drop question categorization with `dnd-kit`
- Drag-and-drop prioritization with `dnd-kit`
- Stage submission flow for non-textarea stages

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```
