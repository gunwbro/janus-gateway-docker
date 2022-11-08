# Janus Gateway with Docker

### Why Docker?

- Janus Gateway는 여러 Dependency 를 필요로 하며 리눅스에서 동작함.
- 따라서 플랫폼에 의존하지 않고 편하게 설정하기 위해 Docker를 사용

### Installation

1. dockerfile을 docker build 명령어를 통해 이미지 생성
2. docker-compose.yml 의 janus-gateway image 이름을 {생성한 이미지 이름}:{태그} 으로 변경
3. docker-compose up --build -d 명령어를 통해 이미지를 띄움 (데모 페이지 필요 없으면 빼도 됨)

### How to use
데모 페이지를 80포트로 설정하였으므로, http://localhost/ 에 접속하여 테스트 한다.
