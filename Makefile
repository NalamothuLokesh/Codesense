.PHONY: dev frontend backend chat-service build

backend:
	node backend/server.js

frontend:
	cd frontend && npm run dev

chat-service:
	python backend/chat_service.py

build:
	cd frontend && npm run build