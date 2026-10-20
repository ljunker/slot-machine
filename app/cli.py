import argparse
import getpass
import os

from sqlalchemy import select

from app.db.base import Base
from app.db.database import SessionLocal, engine
from app.models.auth import User
from app.services.auth import normalize_email, password_hash


def main() -> None:
    parser = argparse.ArgumentParser(description="Event Scheduler Verwaltung")
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("create-superadmin")
    create.add_argument("--email", required=True)
    create.add_argument("--password-env", help="Nur für automatisierte Setups")
    args = parser.parse_args()
    if args.command != "create-superadmin":
        parser.error("Unbekannter Befehl")
    password = os.environ.get(args.password_env) if args.password_env else getpass.getpass("Passwort: ")
    if password is None:
        parser.error("Passwort-Umgebungsvariable fehlt")
    email = normalize_email(args.email)
    hashed = password_hash(password)
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        if db.scalar(select(User.id).where(User.is_superadmin)) is not None:
            parser.error("Ein Superadmin ist bereits vorhanden")
        if db.scalar(select(User.id).where(User.email == email)) is not None:
            parser.error("E-Mail-Adresse ist bereits vergeben")
        db.add(User(email=email, password_hash=hashed, is_superadmin=True))
        db.commit()
    print(f"Superadmin angelegt: {email}")


if __name__ == "__main__":
    main()
