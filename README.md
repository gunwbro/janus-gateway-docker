# Janus Gateway with Docker

- Janus Gateway는 여러 Dependency 를 필요로 하며 리눅스에서 동작함.
- 따라서 플랫폼에 의존하지 않고 편하게 설정하기 위해 Docker를 사용
- 프론트, 미디어 서버를 모두 띄우기 위해 docker-compose 를 사용함

### Usage

1. `docker-compose up --build -d` 명령어를 통해 이미지를 띄움
2. docker-compose.yml 에서 설정한 포트번호로 http://localhost:{port}/ 에 접속한다.
