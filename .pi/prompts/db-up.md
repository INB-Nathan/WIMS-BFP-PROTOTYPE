Bring up the full Docker stack (fresh start destroys volumes). Use "fresh" for a clean rebuild, "restart" for a normal restart.

cd src && docker compose down -v && docker compose up --build -d
