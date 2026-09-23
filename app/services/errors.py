class DomainError(Exception):
    status_code = 400

    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class NotFound(DomainError):
    status_code = 404


class Conflict(DomainError):
    status_code = 409
