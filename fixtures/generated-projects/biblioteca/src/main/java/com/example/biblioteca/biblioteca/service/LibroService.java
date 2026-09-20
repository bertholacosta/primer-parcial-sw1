package com.example.biblioteca.biblioteca.service;

import com.example.biblioteca.biblioteca.dto.LibroDTO;
import com.example.biblioteca.biblioteca.entity.LibroEntity;
import com.example.biblioteca.biblioteca.repository.LibroRepository;
import org.springframework.stereotype.Service;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;
import com.example.biblioteca.biblioteca.dto.AutorDTO;
import com.example.biblioteca.biblioteca.entity.AutorEntity;

@Service
public class LibroService {

    private final LibroRepository repository;

    public LibroService(LibroRepository repository) {
        this.repository = repository;
    }

    public List<LibroDTO> findAll() {
        return repository.findAll().stream().map(this::toDTO).toList();
    }

    public Optional<LibroDTO> findById(Long id) {
        return repository.findById(id).map(this::toDTO);
    }

    public LibroDTO save(LibroDTO dto) {
        return toDTO(repository.save(toEntity(dto)));
    }

    public void deleteById(Long id) {
        repository.deleteById(id);
    }

    private LibroDTO toDTO(LibroEntity entity) {
        LibroDTO dto = new LibroDTO();
        dto.setId(entity.getId());
        dto.setTitulo(entity.getTitulo());
        dto.setIsbn(entity.getIsbn());
        dto.setFechaPublicacion(entity.getFechaPublicacion());
        dto.setEscritoPors(entity.getEscritoPors() == null ? null : entity.getEscritoPors().stream().map(this::toAutorDTOShallow).toList());
        return dto;
    }

    private LibroEntity toEntity(LibroDTO dto) {
        LibroEntity entity = new LibroEntity();
        entity.setId(dto.getId());
        entity.setTitulo(dto.getTitulo());
        entity.setIsbn(dto.getIsbn());
        entity.setFechaPublicacion(dto.getFechaPublicacion());
        entity.setEscritoPors(dto.getEscritoPors() == null ? null : dto.getEscritoPors().stream().map(this::toAutorEntityShallow).collect(Collectors.toList()));
        return entity;
    }

    private AutorDTO toAutorDTOShallow(AutorEntity entity) {
        AutorDTO dto = new AutorDTO();
        dto.setId(entity.getId());
        dto.setNombre(entity.getNombre());
        return dto;
    }

    private AutorEntity toAutorEntityShallow(AutorDTO dto) {
        AutorEntity entity = new AutorEntity();
        entity.setId(dto.getId());
        entity.setNombre(dto.getNombre());
        return entity;
    }
}
