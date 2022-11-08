FROM ubuntu:bionic
RUN echo ' \n\
APT::Periodic::Update-Package-Lists "0";\n\
APT::Periodic::Unattended-Upgrade "1";\n'\
> /etc/apt/apt.conf.d/20auto-upgrades
RUN set -x \
    && apt-get update && apt-get install -y build-essential snapd aptitude git wget golang \
    python3 python3-pip python3-setuptools python3-wheel ninja-build \
    libgstreamer1.0-dev libgirepository1.0-dev libunwind-dev apt-utils libsrtp-dev \
    gdb \
    && aptitude install -y libmicrohttpd-dev libjansson-dev libnice-dev \
    libssl-dev libsofia-sip-ua-dev libglib2.0-dev libopus-dev libogg-dev \
    libconfig-dev libavutil-dev libavcodec-dev libavformat-dev libnanomsg-dev \
    libcurl4-openssl-dev liblua5.3-dev pkg-config gengetopt libtool automake curl jq httpie vim screen doxygen graphviz
RUN set -x \
    && wget https://cmake.org/files/v3.16/cmake-3.16.2.tar.gz \
    && tar -xvzf cmake-3.16.2.tar.gz \
    && cd cmake-3.16.2 \
    && ./bootstrap --prefix=/usr/local \
    && make && make install
RUN set -x \
    && python3 -m pip install meson \
    && python3 -m pip install ninja
RUN  set -x \
    && cd  \
    && wget https://github.com/cisco/libsrtp/archive/v2.2.0.tar.gz \
    && tar xfv v2.2.0.tar.gz  \
    && cd libsrtp-2.2.0/ \
    && ./configure --prefix=/usr --enable-openssl \
    && make shared_library && make install
RUN  set -x \
    && git clone https://boringssl.googlesource.com/boringssl \
    && cd boringssl \
    && sed -i s/" -Werror"//g CMakeLists.txt \
    && mkdir -p build \
    && cd build \
    && cmake -DCMAKE_CXX_FLAGS="-lrt" .. \
    && make \
    && cd .. \
    && mkdir -p /opt/boringssl \
    && cp -R include /opt/boringssl/ \
    && mkdir -p /opt/boringssl/lib \
    && cp build/ssl/libssl.a /opt/boringssl/lib/ \
    && cp build/crypto/libcrypto.a /opt/boringssl/lib/
RUN  set -x \
    && git clone https://github.com/sctplab/usrsctp \
    && cd usrsctp \
    && ./bootstrap \
    && ./configure --prefix=/usr --disable-programs --disable-inet --disable-inet6 \ 
    && make && make install
RUN  set -x \
    && git clone https://github.com/warmcat/libwebsockets.git \
    && cd libwebsockets \
    && mkdir build \
    && cd build \
    && cmake -DLWS_MAX_SMP=1 -DLWS_WITHOUT_EXTENSIONS=0 -DCMAKE_INSTALL_PREFIX:PATH=/usr -DCMAKE_C_FLAGS="-fpic" .. \
    && make && make install
RUN set -x \
    && git clone https://github.com/eclipse/paho.mqtt.c.git \
    && cd paho.mqtt.c \
    && make && make install
RUN set -x \
    && git clone https://github.com/alanxz/rabbitmq-c \
    && cd rabbitmq-c \
    && git submodule init \
    && git submodule update \
    && mkdir build && cd build \
    && cmake -DCMAKE_INSTALL_PREFIX=/usr .. \
    && make && make install
RUN set -x \
    && git clone https://gitlab.freedesktop.org/libnice/libnice \
    && cd libnice \
    && meson --prefix=/usr build && ninja -C build && ninja -C build install
RUN export JANUS_WITH_POSTPROCESSING
RUN  set -x \
    && git clone https://github.com/meetecho/janus-gateway.git \
    && cd janus-gateway \
    && sh autogen.sh \
    && ./configure --prefix=/opt/janus \
    && make \
    && make install \
    && make configs
RUN  set -x \
    && rm -rf /libwebsockets \
    && rm -rf /janus-gateway \
    && rm -rf /boringssl
RUN adduser --disabled-password --gecos '' janus
USER janus
CMD ["/opt/janus/bin/janus"]