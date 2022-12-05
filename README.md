# Janus Gateway with Docker

### Why Docker?

- Janus Gateway는 여러 Dependency 를 필요로 하며 리눅스에서 동작함.
- 따라서 플랫폼에 의존하지 않고 편하게 설정하기 위해 Docker를 사용
- 프론트, 미디어 서버를 모두 띄우기 위해 docker-compose 를 사용함

### Usage

1. Dockerfile을 `docker build` 명령어를 통해 이미지 생성
2. docker-compose.yml 의 janus-gateway image 이름을 {생성한 이미지 이름}:{태그} 으로 변경
3. `docker-compose up --build -d` 명령어를 통해 이미지를 띄움
4. docker-compose.yml 에서 설정한 포트번호로 http://localhost:{port}/ 에 접속한다.
