.PHONY: dev frontend backend chat-service start-all build

backend:
	node backend/server.js

frontend:
	cd frontend && npm run dev

chat-service:
	python backend/chat_service.py

start-all:
	bash backend/start.sh

build:
	cd frontend && npm run build